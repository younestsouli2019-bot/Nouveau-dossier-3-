# Route decision — swarm consensus record (2026-11-04)

**Status:** decided and acting. This record is the reasoning trail, not a
proposal.

## Inputs

**Agent registry** (5 agents, all `active`, all last heartbeat
`2026-09-03T05:03:00Z`):

| agent | role | allowed intents |
|---|---|---|
| settlement-agent | disbursement | disburse, settle |
| auto-disburse | disbursement | disburse |
| critic-agent | critic | audit, analyze, report |
| supervisor | supervisor | supervise, audit, elevate, heal |
| superagent | orchestrator | disburse, settle, approve, audit, elevate, heal |

**Honesty note:** the heartbeats have not moved since 3 September. These are
registry records, so the "votes" below are role-derived positions on the
evidence — not messages from live reasoning processes. Zero daily volume and
zero daily transactions in the registry reflect the stale heartbeats, not
current throughput.

**Measured throughput** (read-only `GET /api/payout-items`, aggregate only):
20 completed PayoutItems, total **$8,401.23**, average ticket **$420.06**,
largest **$1,717.56**, all USD, dated 2026-08-22 → 2026-09-01.
Run-rate over those 11 days: ≈54 payouts/month, ≈**$22.9k/month**. This is an
extrapolation of a short window, not a forecast.

**Eligibility evidence** (see `payments/RAIL-ELIGIBILITY.md`): the storefront
entity appears to be Moroccan (Attijariwafa rail, MA jurisdiction in the
ledger record, user locale MA). Provider country gates therefore dominate the
decision: Stripe, Airwallex and Wise Business do not onboard an MA-registered
entity, and Payoneer company applications for MA are commonly refused.

## Positions

| agent | position | rationale |
|---|---|---|
| settlement-agent | MoR for collections; keep Attijariwafa for payouts | adds no new clearing dependency to reconcile |
| auto-disburse | MoR; do not apply to tier-1 clearing with an MA entity | a second rejection wastes weeks and leaves payouts where they are |
| critic-agent | MoR is the only zero-new-entity path; document the volume evidence | matches the measured $22.9k/mo run-rate |
| supervisor | act only on reversible steps; no account applications without owner documents | applications create legal representations only the owner can make |
| superagent | execute the reversible work now; defer entity decisions | reversible work has no downside if the entity choice changes |

**Consensus: 5/5 for Merchant of Record as the immediate collection rail.
5/5 against submitting Airwallex / Wise / 3S Money applications under the
current entity. 0/5 for waiting on Stripe.**

## Decision

1. **Activate Merchant-of-Record rails now** (Paddle, then Lemon Squeezy).
   The checkout route already falls through Stripe → Paddle → Lemon Squeezy
   and fails closed with a clear buyer message when none are configured.
2. **Keep Attijariwafa as the settlement bank** and PayPal/USDT as existing
   collection options.
3. **Defer the foreign-entity decision** (UK LTD or EU entity → Airwallex /
   Wise / 3S Money) until the owner supplies incorporation and UBO documents.
   Trigger to revisit: sustained volume above **$50k/month** or **500+**
   transactions/month, where tier-1 clearing economics outweigh formation cost.
4. **Send the Banking Circle feedback request** through the relationship or
   portal channel — never to a guessed address.

## Autonomous vs owner-gated

**Done autonomously (code, reversible):** multi-rail checkout fallback with
host allowlisting, readiness endpoint, 8 tests, eligibility matrix, this
record, env template.

**Owner-gated (legal or credential-bearing):** creating the MoR accounts and
product links; any foreign entity formation; submitting bank applications;
sending the feedback request from the owner's mailbox.

## Known dependency

The fallback only reaches buyers once the Vercel deployment is repaired.
`de4f29d` failed there: invalid `VERCEL_TOKEN`, and `VERCEL_ORG_ID` /
`VERCEL_PROJECT_ID` absent at repo and production-environment level.
