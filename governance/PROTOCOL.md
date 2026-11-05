# Upgrade Timelock Protocol

Status: implemented as a CI gate (`npm run governance:check`). Not yet wired
into the deploy workflow — that file needs `workflow` scope to edit.

## Why not an on-chain contract

The protected system is PostgreSQL + a Next.js deploy pipeline. There is no
on-chain state for a Solidity timelock to guard, so a deployed contract would
be theatre: it could not block a `prisma migrate` or a Vercel promotion. Each
contract guarantee has a real equivalent here, and only the CI enforcement
point makes them binding.

## Guarantee mapping

| Smart-contract concept | Implementation here |
|---|---|
| `propose()` stores calldata hash | `governance/proposals/<id>.json` with commit + `diffHash` |
| `delay` / `eta` | `MIN_DELAY_MS` per risk tier: config 24h, workflow 48h, schema 72h, money-path 7d |
| `QUEUE` state | `status: "pending"` evaluated against `proposedAt` |
| `quorum` / multi-sig | distinct approvers ≥ `quorum`, proposer excluded |
| Calldata immutability | every approval carries `diffHash`; any change invalidates approvals |
| `execute()` | deploy job runs `governance:check`; non-zero exit blocks promotion |
| `cancel()` (guardian) | any reviewer can cancel; status becomes `cancelled` |
| Emergency path | rollback-only, 1h delay, 2× quorum, `rollbackOf` required |
| On-chain event log | `AuditLedger` hash-chained rows (append-only) |
| Contract address / bytecode | the proposal file + its 64-char digest (`proposalDigest`) |

## Risk tiers

| Tier | Delay | Applies to |
|---|---|---|
| config | 24h | env values, prices, feature flags |
| workflow | 48h | `.github/workflows`, automation definitions |
| schema | 72h | Prisma migrations, DDL |
| money-path | 7d | payout, settlement, treasury, signing keys |

## Lifecycle

1. **Propose** — open a PR containing the change plus a proposal file. Set
   `commit` (full SHA), `diffHash` (sha256 of the reviewed diff), `riskTier`,
   `quorum`, and `proposedAt` equal to the commit timestamp, not "now".
2. **Review** — reviewers add approvals as commits, each carrying the same
   `diffHash`. Approving a different hash is rejected by the gate, so a change
   pushed after review invalidates quorum automatically.
3. **Wait** — the delay runs from `proposedAt`. Nothing to ping; the gate
   computes the remainder.
4. **Execute** — the deploy job runs `governance:check <proposal>.json`.
   Exit 0 promotes; exit 1 (immature, quorum short, expired) or exit 2
   (unreadable/malformed) blocks. Fail-closed by construction.
5. **Record** — execution writes an `AuditLedger` row with the digest, commit,
   approvers and tier before the deploy step.

## Threat model

| Threat | Control |
|---|---|
| Compromised single owner | quorum ≥ 2 with distinct identities; proposer excluded |
| Malicious commit after approval | approval binds to `diffHash`; gate rejects mismatch |
| Force-push rewriting history | branch protection + required reviews; proposal commits are immutable in practice |
| CI bypass via flag | there is no bypass flag; emergency path is rollback-only and logged |
| Clock manipulation | evaluate against server time; `proposedAt` must match the commit timestamp |
| Replaying an old approval | 14-day TTL and digest binding |
| Silent no-op (gate never runs) | absence is visible: the deploy job requires exit 0; no default-allow branch exists |

## Anti-patterns (do not add)

- Approvals in chat or comments without a committed `diffHash`.
- Mutable proposal files: editing one after approval must invalidate quorum.
- `quorum: 1`, or letting the proposer approve their own change.
- Any `SKIP_GOVERNANCE` environment escape hatch.
- Treating "no proposal found" as allowed. Missing evidence is denial.

## Rollout

1. Merge this protocol + gate (done).
2. Add the gate step to `deploy-vercel.yml`'s `release gates G1-G4` job.
3. Start with `config` tier only; run for two weeks and confirm denials behave.
4. Add `schema` and `money-path`; keep emergency rollback available.
5. Only then consider signing proposals with a hardware key.
