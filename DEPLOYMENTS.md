# Deployments & Live Endpoints

This is the canonical registry of live swarm/base44 deployments. The actual revenue / payout
machinery is deployed as Base44 apps (`*.base44.app`) fronted by `space-z.ai` public URLs.

## Primary deployments (do NOT forget these two)

| URL | App | Base44 API | Notes |
|-----|-----|-----------|-------|
| https://x1he4604ap01-deploy.space-z.ai/ | **HIT Swarm · Autonomous Revenue Engine** | agent-swarm.base44.app | Dashboard: Swarm, Missions, HIT Pipeline, Revenue, **Payouts**, Marketplace, Settlement, Truth/Reality/Security Audits, Exchanges (Binance/Bybit), Acquisition, Verification. **Never ran a tick — Autopilot OFF, "No tick yet."** This is the engine that must be STARTED before any revenue can reach owner accounts. |
| https://b1fx661hzse0-d.space-z.ai/ | **AgentFlow AI Command Center (AICC)** | https://agent-flow-ai-9855ea98.base44.app/api | Truth-Only UI: ON · NO_PLATFORM_WALLET=true · SWARM_LIVE=true · Owner payouts direct. Modules: Payment Ops (Payouts · Attijari · resilience), Revenue, Swarm, Missions, Campaigns, WET-RUN, Auto-Remediation, E-Commerce Swarm (browser swarm · VCC · ledger), Revenue Split (double-entry ledger · owner payouts · pipeline). |

## Other referenced endpoints

| URL | Purpose |
|-----|---------|
| https://t1trn6kunnv1-d.space-z.ai/ | Primary app — Swarm Command Center / main deployed app (GitHub webhook listener at `/api/webhook/deploy`). |
| https://c1h9c7ut5hm0-d.space-z.ai/ | Referenced develop/deploy target (pre-flight sandbox rehearsal). |
| https://preview-chat-886213b3-6e3f-40a0-9d23-681bb5b735a6.space-z.ai/ | Chat/preview (prior session context). |

## Owner payout facts (as of 2026-08-28)

- **No real funds have reached any pre-set owner account.** Root cause: the revenue engine
  (HIT Swarm) has **never executed a tick** — no revenue has been generated/settled, so there is
  nothing to pay out.
- Ledger (`authorizer-ledger-report.json`) balances: **all $0**, incl. `4000-Owner-Payable`.
- Base44 RevenueEvents/TransactionLogs: **all `cancelled`** (85 / 158).
- 27 local outbound settlements "completed" with **no external proof** (unverified).
- **Wise owner rail is READY:** valid `OWNER_WISE_API_TOKEN` (200 OK) → owner Wise account
  `73c0818e-6405-4645-abda-5046453370eb` (bank: Banking Circle LU7740800...). A real payout can
  execute the moment a genuine funded amount exists.

## Next step to get funds flowing

1. **START the engine:** hit **"Run tick"** (or flip **Autopilot ON**) on the
   HIT Swarm dashboard at https://x1he4604ap01-deploy.space-z.ai/.
2. Once a tick generates **real, settled revenue** (with external proof), route it to the
   pre-set owner accounts via the Wise rail above.
