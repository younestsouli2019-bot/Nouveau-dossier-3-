# Settlement & Payout State Machine (P0 rollout — 2026-09-07)

Fixes the structural settlement gap: revenue could become an internal
accounting state with no guaranteed, durable path from **economic
entitlement → verified payout instruction → external settlement →
reconciliation**. The gap (`???` between instruction and settlement) is now
owned by a durable state machine — not a cron, not an agent, not a JSON file.

## Core distinctions (machine-enforced)

```
INSTRUCTION  !=  SUBMISSION  !=  ACCEPTANCE  !=  SETTLEMENT  !=  RECONCILIATION
```

`settlements/paypal/paypal_instruction_*.json` artifacts were **payout
instructions, never payment records**. They have been removed from Git
(private backup retained). Git holds code, schemas, policies — never payment
state, bank destinations, or reconciliation evidence.

## Payout lifecycle

```
CREATED → ELIGIBLE → RESERVED → VALIDATED → READY → SUBMITTING → SUBMITTED
        → PROCESSING → COMPLETED → RECONCILED
```

Failure branches: `VALIDATION_FAILED`, `PROVIDER_REJECTED`,
`RETRYABLE_FAILURE`, `UNKNOWN`, `QUARANTINED`, `CANCELLED`.

Rules enforced by `src/payout/state-machine.ts` (`assertTransition`):

- **Only legal transitions.** The transition table is closed; anything else
  throws. No arbitrary status mutation anywhere.
- **UNKNOWN never retries.** After a mid-flight failure nobody knows whether
  the provider executed. `UNKNOWN → SUBMITTING` does not exist in the table.
  `UNKNOWN` resolves only via provider reconciliation into `COMPLETED`
  (found) or `QUARANTINED` (not found).
- **Retries re-enter through validation.** `RETRYABLE_FAILURE`/`PROVIDER_REJECTED`
  may loop back to `READY` only — full policy validation, destination check,
  and idempotency check run again.
- **Every transition is durable.** Callers write `Payout.status`, an
  append-only `PayoutEvent`, and the version bump in ONE transaction.

## Balances are derived, never stored

`heldBalance`/`spendableBalance` buckets are NOT authoritative. Available
funds are folded from ledger entries (`src/payout/ledger.ts`):

```
available = credits − reservations − settled payouts
```

Every number answers "because of these ledger lines". Reservations can never
push `available` negative (`canReserve`).

## Idempotency & provider references

Every `Payout` row carries a unique `idempotencyKey`, `provider`,
`providerRequestId`, and `providerTransactionId`. A COMPLETED payout without
an external reference is a `MISSING_EXTERNAL_REFERENCE` watchdog finding.

## UNKNOWN & evidence gaps

Per the L2 audit (PayPal REST history gap 2026-08-26→28), missing evidence is
a first-class reconciliation state:

- `EVIDENCE_PENDING` — provider reference unknown (evidence gap)
- `RECONCILIATION_REQUIRED` — internal/provider mismatch to investigate

**Never automatically pay again because evidence is missing.** That is how
duplicate payouts happen.

## Watchdogs (diagnose only — they move nothing)

- **Treasury Watchdog** (`src/treasury/watchdog.ts`): unreconciled revenue,
  stale held balances (every hold has `holdReason`/`nextReviewAt`/`expiresAt`
  — "held forever" is structurally impossible), eligible payouts, UNKNOWN
  provider operations, missing external references.
- **Reconciliation Watchdog** (`src/recon/watchdog.ts`): internal ↔ provider
  comparison producing `MATCHED | MISSING_PROVIDER | MISSING_INTERNAL |
  AMOUNT_MISMATCH | CURRENCY_MISMATCH | DUPLICATE | EVIDENCE_PENDING`.

## Automation policy

`ELIGIBLE_FOR_PAYOUT` findings create **payout proposals**, not payments.
Dispatch (P2) stays behind: `SWARM_LIVE` (default **false** — including proof
generation, which now also defaults false and can never overstate live mode),
PPP2 approval + send-enablement, owner-destination validation, bounded batches
(`MAX_PAYOUT_PER_TRANSACTION`, `MAX_DAILY_PAYOUT`, `MAX_BATCH_SIZE`,
`MAX_PROVIDER_EXPOSURE`), and manual approval for all payouts (fail-closed).
No `for (account) releaseOwnerFunds()` loop exists or will be added.

## Rollout status

- **P0 done (this commit):** payout ledger + state machine + idempotency +
  UNKNOWN + artifacts out of Git + machine-readable audit JSON + live-gate
  default fix.
- **P1 next:** wire watchdogs into the scheduler against real Prisma reads;
  provider abstraction (`PayoutProvider` interface: validateDestination /
  quote / createPayment / getPayment / reconcile / cancel) with PayPal,
  bank, crypto, Payoneer implementations; owner-destination registry backed
  by `OwnerAccount` (env vars remain a security boundary, never the
  authoritative registry).
- **P2 (gated):** autonomous payout dispatch — only after P1 is proven with
  clean watchdog runs over a sustained period.

**Schema note:** new models (`Payout`, `PayoutEvent`, `PayoutHold`) are
additive; run `prisma db push` (or generate a migration) at the next deploy.
