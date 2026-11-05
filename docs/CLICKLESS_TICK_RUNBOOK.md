# 🐝 Clickless Swarm Tick — Runbook

**Script:** `scripts/swarm-clickless-tick.mjs`
**Workflow:** `.github/workflows/swarm-tick.yml` (every 30 min + manual dispatch)
**Local run:** `npm run swarm:tick:clickless`
**Journal:** `logs/swarm_clickless/tick-<stamp>.json` + `latest.json`

---

## What it is — and what it must never be

The clickless tick is the swarm's **READ-ONLY heartbeat**. It reconciles,
guards, audits health and procurement delivery status, and writes a journal
stamp. That is all.

It is **fail-closed by construction**:

- it NEVER creates payouts, never funds cards, and never calls the
  orchestrator's `maybePayout()`;
- it NEVER flips a shipment to `delivered` without a real recorded waybill —
  `delivered` stays gated on a real carrier scan;
- it NEVER moves money, and the journal proves it (`readonly: true`,
  `moved_money: false` on every tick).

If you are adding a phase to this tick, it must hold the same property: the
tick only *verifies* and *advances procurement that already has a real
waybill (shipped)*. Anything that moves money belongs behind the operator
auth gate on `/api/healthz`, not in the tick. See
[SWARM_CUSTODIANSHIP.md](./SWARM_CUSTODIANSHIP.md) and
`scripts/verify-swarm-invariants.mjs` (I3/I4).

---

## Phase map

| Phase | Entry | DB? | What it does |
|---|---|---|---|
| 1 | `truth-invariant-audit` | no | Repo-wide truth invariants (no fabricated proof). |
| 1 | `url-guard-self-test` | no | SSRF guard self-test. |
| 2 | `payout-reconcile` | yes | Read-only payout reconcile (skipped without `DATABASE_URL`). |
| 2 | `postgres-integrity-audit` | yes | Read-only DB integrity audit (skipped without `DATABASE_URL`). |
| 2 | `inbound-scout` | no | Scans `data/inbound/receipts` for inbound evidence. |
| sched | `stuck-payout-summary` | yes | **Only** during the 05:00–05:59 UTC scheduled window (`GITHUB_EVENT_NAME=schedule`) or manual dispatch; summary-only mode. |
| 3 | `rail-health` | no | Read-only rail health probe (if the report script exists). |
| 3.5 | `financial-policy`, `remediate-proof-gaps`, `rail-funding-monitor`, `procurement-delivery-watchdog` | no | Autonomous watchers — dry/read-only, never move money, never fabricate proof. |
| 3.6 | `settlement-worklist`, `procurement-payment-queue`, `po-execution-queue`, `payment-routing-table`, `po-fulfillment-orchestrator`, `evm-wallet-balance` | no | Structured action queues for the **operator** to execute manually (Attijari app / cash). No API path. |
| 3.7 | `legal-entity-audit`, `legal-quarantine-sweep`, `provider-metadata-fraud-scan` | no | R2/R3/R4 hardening directives (quarantine sweep is DRY inside the tick; `--apply` is operator-only). |
| host | `stuck-payout-audit` (v2) | yes | Host/CI-side audit via `npx tsx`, **only when `DATABASE_URL` is present**; strictly SELECT-only. |
| 4 | journal stamp | — | Writes the tick report after **every** phase completes. |

Errors in any phase are recorded in the journal; they **never** block the
journal and the process still exits `0` (a hard tooling failure is the only
thing that can crash it — never a reason to force a payout).

---

## Environment matrix

| Variable | Effect when set | Effect when absent |
|---|---|---|
| `DATABASE_URL` | Enables Phase 2 DB reconciles + host stuck-payout audit. | DB-backed phases are skipped (`skip_no_db`); static/health audits still run. |
| `PLAN_TRANSITION_MODE` | `1` in CI; recorded in the journal as `plan_transition_mode`. | Journal records `unset`. |
| `GITHUB_EVENT_NAME=schedule` | Enables the stuck-payout summary inside the 05:00–05:59 UTC window. | Summary not scheduled. |
| `GITHUB_EVENT_NAME=workflow_dispatch` | Manual dispatch runs the stuck-payout summary regardless of hour. | — |
| `AUTOCOMMIT_ENABLE=true` (repo var) | swarm-tick.yml commits `logs/swarm_clickless/` to **this public repo**. | Reports stay as workflow artifacts only (30-day retention). |

> ⚠️ Because the journal can be autocommitted publicly, the
> `stuck-payout-audit` journal entry is **REDACTED to a bare status**
> (`scripts/lib/swarm-tick-report.mjs → redactedAuditDetail()`). Full audit
> output goes to the **job log only**. This is the standing isolation rule:
> payout/PII detail never lands in a public repo.

---

## Journal schema

`logs/swarm_clickless/latest.json`:

```json
{
  "at": "2026-11-05T15:41:02.123Z",
  "uid": "clickless-2026-11-05T15-40-00-000Z",
  "elapsed_ms": 62123,
  "plan_transition_mode": "1",
  "readonly": true,
  "moved_money": false,
  "phases": [
    { "name": "truth-invariant-audit", "status": "ok", "tail": "…last 400 chars…" },
    { "name": "payout-reconcile", "status": "skip_no_db" },
    { "name": "stuck-payout-audit", "status": "ok",
      "tail": "(redacted: full stuck-payout audit output stays in the job log — standing isolation rule)" }
  ],
  "note": "READ-ONLY reconcile/guard/audit tick. …"
}
```

Contract (enforced by `scripts/lib/swarm-tick-report.mjs`, unit-tested in
`scripts/lib/swarm-tick-report.test.mjs`):

- every phase entry is `{ name, status, tail? }` — no one-off shapes;
- `status ∈ ok | error | skip_missing | skip_no_db | …`;
- `tail` holds at most the last 400 chars of output **except** for the
  stuck-payout audit, which is always the redaction note;
- `uid` matches the journal filename stamp (captured at tick start);
- `readonly` / `moved_money` are hard-coded — never configurable.

---

## Operator quickstart

```bash
# 1. Run the tick locally (no DATABASE_URL → static phases only)
npm run swarm:tick:clickless

# 2. Read the latest journal
cat logs/swarm_clickless/latest.json | jq '.phases[] | select(.status != "ok")'

# 3. Verify repo-wide swarm invariants after any workflow/tick change
node scripts/verify-swarm-invariants.mjs
```

Interpreting results:

- `ok` — phase passed; `tail` carries its closing output.
- `skip_no_db` / `skip_missing` — expected outside CI (no DB / script not
  present); not failures.
- `error` — the phase's own audit failed; read `tail`, then fix the root
  cause. Do **not** widen the tick's permissions to "fix" an audit error —
  that is the one move the fail-closed doctrine forbids.

---

## Related

- [SWARM_CUSTODIANSHIP.md](./SWARM_CUSTODIANSHIP.md) — fix-it-if-you-see-it doctrine
- [SWARM_BUG_SENTINEL.md](./SWARM_BUG_SENTINEL.md) — bug sentinel loop
- [SETTLEMENT_STATE_MACHINE.md](./SETTLEMENT_STATE_MACHINE.md) — why `delivered` needs a real carrier scan
- `scripts/verify-swarm-invariants.mjs` — I1–I7 post-repair gate
