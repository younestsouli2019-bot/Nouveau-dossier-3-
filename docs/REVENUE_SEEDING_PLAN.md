# Internal RevenueEvent Seeding Plan

Status: DRAFT — approved by owner to implement tooling; no live seed without
concrete revenue evidence.

## 1. Why this exists

The payout pipeline gates every payout on a **derived** balance
(`src/payout/ledger.ts`): `available = credits − reservations − settledPayouts`.
Credits only accrue from `REVENUE` / `OWNER_ENTITLEMENT` / `ADJUSTMENT` ledger
rows. Today **no code path writes owner-creditable REVENUE rows**, so
available is structurally locked at `$0` and the ELIGIBLE→RESERVED gate fails
with `insufficient-available` (`src/payout/pipeline.ts:252-261`,
`canReserve` at `src/payout/ledger.ts:91-95`).

Owner directive: PO funding must come from the **swarm internal ledger and
generated revenues (Base44 RevenueEvents)** — never from owner bank accounts.

## 2. Terminology

| Term | Meaning |
|---|---|
| `RevenueEvent` | Base44 entity (durable source of record), created via `src/base44-revenue.mjs`, consumed by `src/orchestrate-settlement.mjs`. |
| Mirror CREDIT row | Internal `RevenueLedgerEntry` (`entryType='CREDIT'`, `metadata.ledgerType='REVENUE'`) on the owner `LedgerAccount`, mapped by `src/payout/prisma-sources.ts:107-133`. This is what `canReserve` actually spends. |
| Base44 SOR half | What `orchestrate-settlement.mjs:360-385` lists; empty → `no_eligible_revenue` abort. |

Both halves must stay **1:1**. A mirror row is never written unless the
corresponding Base44 `RevenueEvent` succeeded (live or offline-queued).

## 3. Current state (verified)

- All 3 procurement missions: `revenue_generated: null`, `items: 0`
  (`data/base44/missions.json`).
- Zero Base44 RevenueEvents. Zero internal REVENUE credit rows.
- Only existing CREDIT writes: treasury bucket allocations on `bucket-<code>`
  accounts, `dataSource: internal_ledger_only` (`src/lib/treasury/buckets.ts:171`),
  explicitly not owner-spendable.
- Write path: `functions.invoke()` returns 402 (needs paid Base44 subscription);
  live entity creates must go through the GitHub Actions push path or the offline
  store (`.base44-offline-store.json`), which is the current mechanism.

## 4. The two halves

### 4.1 Base44 RevenueEvent
Fields: `amount` (>0), `currency` (payout currency, USD), `occurred_at`,
`source`, `external_id` (unique, dedup key with `source`), `mission_id`,
`mission_title`, `metadata`, auto `event_hash` (sha256)
(`src/base44-revenue.mjs:51-118`). Created idempotently:
`createBase44RevenueEventIdempotent` (`src/base44-revenue.mjs:146-177`).

### 4.2 Mirror CREDIT row
- `accountId` → owner `LedgerAccount` (`ownerId = <ownerAccountId>` or
  `id = <ownerAccountId>`, currency match — same predicate as
  `listLedgerEntries`, `src/payout/prisma-driver.ts:63-69`). Created if absent:
  `swarm-treasury:<ownerAccountId>:<currency>`.
- `entryType='CREDIT'`, `state='SETTLED'`, `metadata.ledgerType='REVENUE'`,
  `metadata.sourceRef=<external_id>`, `processorRef=<external_id>`,
  `rail=<source>`, `proofHash=sha256(JSON.stringify(evidence))`,
  `idempotencyKey='revenue:<external_id>:<currency>'` (replay-safe, mirrors the
  `payout:{id}:{TYPE}` pattern).

## 5. Per-PO funding targets (when triggered)

| PO | Recipient | MAD | ≈USD (0.1 FX) | mission_id |
|---|---|---|---|---|
| SWARM-PO-2026-001 | Hind Tsouli | 4,547 | 454.70 | `6a9c30da39672fdc5d3e0f85` |
| SWARM-PO-2026-002 | Younes Tsouli | 18,065 | 1,806.50 | `6a9c30db93b84f014bc5f86f` |
| SWARM-PO-2026-003 | Bachir Tsouli | 3,302 | 330.20 | `6a9c30dbcc198a993c6ba86a` |
| **Total** | | **25,914** | **2,591.40** | |

Seeding is in the payout currency (USD). MAD PO amounts convert at the PO
`exchangeRateUSD` (0.1).

## 6. Anti-fabrication guardrails (mandatory)

1. **No synthetic revenue.** Every event must carry a real `externalId`,
   `source`, `occurredAt`, and `metadata.evidence` (external confirmation ref,
   tx/credit hash, or signed invoice). The seeder rejects events without
   evidence.
2. **No pre-seeding without real revenue.** Until a verifiable generated
   revenue instance exists (cert sales, GLM/marketplace credits, affiliate
   payout), the seed file must remain empty. Seeding is a recording act, not a
   top-up.
3. **1:1 integrity.** Mirror rows are written only after the Base44 event
   succeeds. Blocked events are reported and never mirrored. Reconcile enforces
   it (below).
4. **Same currency.** Mirror amount/currency must equal the Base44 event and
   the target `LedgerAccount` currency.
5. **Fail-closed runbook.** Seeder is `--dry-run` by default; live requires
   `SWARM_LIVE=true` and non-offline mode.
6. This does NOT unblock delivery. Recipients are only delivered once real
   carrier waybills exist (`data/out/waybills.csv` → `apply-waybills.mjs`).
   Funding does not gate `ordered → shipped → delivered`
   (`src/payout/pipeline.ts:142-150, 206-221`); it only gates the final
   `payoutReleaseGate` at SETTLED (`pipeline.ts:290-433`) which additionally
   needs a real external rail.

## 7. Runbook

### 7.1 Build the seed file
`data/out/revenue-seed.json` — JSON array, only confirmed revenue:

```json
[
  {
    "externalId": "rev-<source>-<seq>",
    "source": "realworldcerts-sale",
    "amount": 454.70,
    "currency": "USD",
    "occurredAt": "2026-09-13T00:00:00.000Z",
    "missionId": "6a9c30da39672fdc5d3e0f85",
    "missionTitle": "Procurement mission: Mrs. Hind Tsouli (A336103)",
    "metadata": {
      "description": "GLM marketplace credit — see evidence",
      "evidence": { "ref": "<real tx/credit ref>", "screenshot": "<file>" }
    }
  }
]
```

### 7.2 Dry-run (no writes)
```bash
node --import tsx scripts/seed-revenue.mjs --file data/out/revenue-seed.json
```

### 7.3 Live (only after review)
```bash
node --import tsx scripts/seed-revenue.mjs --file data/out/revenue-seed.json \
  --live --owner-account <OwnerAccount.id or env SWARM_TREASURY_ACCOUNT_ID>
```
If Base44 write is blocked (402), the affected events are reported as
`base44Blocked` and are **not mirrored**. They must be pushed via the GitHub
Actions path (or `BASE44_OFFLINE=true` queue + flush) before mirroring.

### 7.4 Verify
```bash
node --import tsx scripts/reconcile-revenue-ledger.mjs
```
Reports `missingMirror` (Base44 event without mirror) and `orphanMirrors`
(mirror without Base44 event) plus derived-available snapshots per owner.

### 7.5 After seeding
- `available` > 0 → eligible payouts can now RESERVE.
- Settlement orchestration sees eligible revenue → can build quotes/payouts
  (no `no_eligible_revenue` abort).
- Delivery still requires real waybills; final money movement requires the
  SETTLED rail + Space-Z deploy fix.

## 8. Non-goals / not covered here

- Reconciling owner bank statements (separate: `CREDENTIAL_ROTATION_RUNBOOK.md`,
  `financial-reconciliation-2026-09-01.md`).
- Fabricating revenue or inflating the treasury.
- Repairing the 100 phantom `shipped` items (procurement side).
- Space-Z stale deployment / HIT swarm 502 (devops side).