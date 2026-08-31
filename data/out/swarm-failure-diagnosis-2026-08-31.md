# Swarm Failure Diagnosis — Why the collective swarm failed to generate REAL funds

Date: 2026-08-31
Status: DIAGNOSED (evidence-backed, read-only analysis produced from live production DB + source)

## Verdict
The swarm **never generated real funds**. The recorded revenue is ledger fiction
($14,363.75 synthetic out of $14,491.05; only **$127.30** carries a real proofHash).
No functional path exists from any "revenue strategy" to a real external payout.

## Root-cause chain

### 1. No income engine — the "strategies" are inert config, not runnable work
- `src/revenue/swarm-autonomous-revenue.js` declares 10 strategies
  (Staking/Yield, DEX Liquidity, CEX Arbitrage, P2P Spread, MEV, Flash Loan, NFT,
  Bug Bounties, Content, Smart Contract Audit) as **config objects with a name only** —
  no execution logic that produces income.
- `src/revenue/swarm-runner.mjs:1-3` is a **3-line no-op stub** that returns
  `{ ok: true, ran: true }` without doing anything.
- `src/revenue/swarm-continuous-runner.js` runs cycles every 5 minutes but only ever
  calls the inert runner.
- Recorded revenue was manufactured from files: `scripts/materialize-revenue-csv.mjs`
  flips CSV `projected` -> `earned`; `scripts/fix-revenue-pipeline.mjs` inserts hardcoded
  procurement rows.

### 2. Every real money rail is unusable (live integration registry)
DB `SwarmIntegration` (live status):
- `paypal`   -> **pending-cip**  (merchant not CIP/KYC-approved; API rejects payouts)
- `wise`     -> **invalid-token** (token rejected by Wise)
- `bitget`   -> **auth-ok-empty** (keys authenticate, account balance EMPTY)
- `bybit`    -> **auth-ok-empty** (keys authenticate, account balance EMPTY)
- `binance`  -> **locked-2015**   (account locked/frozen)
- `wise_v3`  -> configured
- `base44-agent-flow` / `base44-agent-swarm` -> configured (agent platform, not revenue)

So even where credentials authenticate (Bitget/Bybit), there is **nothing to withdraw**;
and the primary disbursement rails (PayPal pending-cip, Wise invalid-token) reject.

### 3. The 2026-08-30 "defang" blocks all synthetic completions (this is CORRECT behavior)
- `src/app/api/ops/auto-pilot/route.ts:11-22` — AutoPilot may no longer mint synthetic
  refs (`PB-…-AP-…`, `UC-…`, `PP-…`), force-complete items, or auto-confirm revenue.
- `completeWithRealProof` (route.ts:73-105) only sets `status=completed` if a **REAL
  provider externalRef already exists**; otherwise it parks the item in
  `needs_manual_proof` with `failureReason: "AUTO-PILOT DEFANG: no REAL provider externalRef"`.
- This is why all 5 `PayoutBatch` sit in `processing` (submittedAt=null, approvedBy=null)
  and all 16 `PayoutItem` sit in `needs_manual_proof` (externalRef=null, proofHash=null).

### 4. DB-level guards reject/quarantine fabricated completions
- `prisma/migrations/20260830000300_*phantom_triggers/migration.sql` — SQL-level
  `PHANTOM_COMPLETED` triggers.
- `src/lib/strict-enforcement/phantom-quarantine.mjs:22,48-53,93-102` — rewrites any
  `completed` PayoutItem lacking a real externalRef/proofHash back to `needs_manual_proof`
  and writes `AuditLedger: PHANTOM_COMPLETED_QUARANTINED`.
- `src/lib/strict-enforcement/truth-guards.ts` (TRUTH-001..008) — fail-closed on any
  completed/settled without real proof.

### 5. Configuration bug: `$env:`-prefixed lines in `.env` never load
- `.env` lines ~28-127 use PowerShell-style `$env:VAR=value` lines.
- `src/load-env.mjs:19-25` splits on `=` and uses the WHOLE left token as the key, so
  `$env:PAYPAL_CLIENT_ID=…` sets `process.env["$env:PAYPAL_CLIENT_ID"]` — NOT
  `PAYPAL_CLIENT_ID`. Only duplicate plain-form lines (e.g. PayPal at `.env:230-231`)
  actually load. This silently breaks any credential that exists only in `$env:` form.

## Why the current (correct) behaviour shows $0 reconciled
The system is behaving **exactly as its anti-fabrication guards require**: it refuses to
claim money moved when none did. The funds were never real. `SettlementExecution` = 0 rows
(zero real settlements ever), `RevenueLedgerEntry` = 0 rows (no internal revenue ledger).

## What would actually generate real funds
1. Fix the `.env` `$env:`-prefix loading bug so credentials load reliably.
2. Point the inert runner at a real, permissioned operation (or remove the fiction and
   replace RevenueEvents with authentic, proof-backed income records).
3. Gated on real external proof: PayPal CIP approval, a valid Wise/BC sender token, or a
   funded exchange account. Until a rail holds spendable funds and authorizes a send,
   NO real payout is possible — and the guards correctly keep everything parked.
