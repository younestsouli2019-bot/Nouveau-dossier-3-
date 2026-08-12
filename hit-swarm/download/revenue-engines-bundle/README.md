# Revenue Engines Bundle — 2026-07-30

This bundle adds **8 new revenue engines** to the ChariBaaS autonomous agentic swarm, sourced from two GitHub repos you provided:

- **https://github.com/orgs/HAiO-labs/repositories** — 4 engines (Solana on-chain + EVM NFT)
- **https://github.com/ncklrs?tab=repositories** — 4 engines (SaaS / agent services)

All 8 engines share a common `RevenueEngine` base class, emit earnings into the existing `.autonomous-offline-store.json` (Earning entity), and are **observe-only by default** — no real money moves unless you explicitly set `REVENUE_ENGINE_MODE=live` AND provide the required secrets.

## New revenue engines at a glance

| # | Engine | Vendor | Revenue model | Currency | Risk | Recommended mode |
|---|---|---|---|---|---|---|
| 1 | `haio-solana` | [HAiO-labs/HAiO-revenue-engine](https://github.com/HAiO-labs/HAiO-revenue-engine) | On-chain USDC inflow → swap to $HAiO → burn % → distribute to Revenue Safe | USDC / HAIO | high | observe |
| 2 | `haio-tx-gateway` | [HAiO-labs/HAiO-solana-programs](https://github.com/HAiO-labs/HAiO-solana-programs) | Membership payments + deposits (multi-token) | USDC + SPL | low | observe |
| 3 | `haio-agent-nft` | [HAiO-labs/HAiO-evm-contracts](https://github.com/HAiO-labs/HAiO-evm-contracts) | ERC-7857 paid mint + protocol fee withdrawal | ETH | low | observe |
| 4 | `haio-vesting` | [HAiO-labs/HAiO-vesting-program](https://github.com/HAiO-labs/HAiO-vesting-program) | Permissionless crank releases vested tokens on schedule | HAIO + SPL | low | observe |
| 5 | `aipipeline-router` | [ncklrs/ai-pipeline](https://github.com/ncklrs/ai-pipeline) | LLM routing API — per-request margin (price charged − upstream cost) | USD | low | observe |
| 6 | `foreman-coding` | [ncklrs/foreman](https://github.com/ncklrs/foreman) | Agentic coding capacity sold per-task (bug fix / feature / refactor) | USD | low | observe |
| 7 | `shipstack-pr` | [ncklrs/shipstack](https://github.com/ncklrs/shipstack) | PR-as-a-service — per-PR billing on merge | USD | low | observe |
| 8 | `applypilot-jobs` | [ncklrs/ApplyPilot](https://github.com/ncklrs/ApplyPilot) | Job placement fees — interview fee + placement % + subscription | USD | low | observe |

## Architecture

```
src/revenue-engines/
├── base.mjs                    Abstract RevenueEngine class — lifecycle, store I/O,
│                               idempotent earning emission, mode resolution
├── registry.mjs                Dynamic engine loader + CLI runner
│                               (list | status | run <name> | run-all)
├── haio-solana.mjs             HAiO on-chain RevenueEngine adapter
├── haio-tx-gateway.mjs         HAiO Transaction Gateway adapter
├── haio-agent-nft.mjs          HAiO AgentNFT (ERC-7857) adapter
├── haio-vesting.mjs            HAiO Vesting Program adapter
├── aipipeline-router.mjs       ncklrs ai-pipeline LLM router adapter
├── foreman-coding.mjs          ncklrs foreman agentic coding adapter
├── shipstack-pr.mjs            ncklrs shipstack autonomous PR adapter
└── applypilot-jobs.mjs         ncklrs ApplyPilot job placement adapter
```

Each adapter:
1. Implements the standard lifecycle: `init() → discover() → earn() → settle() → status()`
2. Inherits idempotent earning emission (re-running never duplicates earnings)
3. Writes earnings into the existing `.autonomous-offline-store.json` `Earning` entity
4. Routes settlement through the existing payout pipeline (PayPal/Bank/Crypto/ChariBaaS)
5. Ships with a safe-by-default **observe mode** stub so the engine can be tested end-to-end without secrets or fund movement

## How earnings flow

```
                    ┌─────────────────────────────────────────┐
                    │  RevenueEngine.run()                    │
                    │                                         │
   HAiO on-chain ─▶ │  ┌─ _discover() ─▶ opportunities       │
   HAiO gateway  ─▶ │  │                                  │   │
   HAiO NFT      ─▶ │  ├─ _earn(opp) ──▶ emitEarning()    │   │ ──▶ .autonomous-offline-store.json
   HAiO vesting  ─▶ │  │                                  │   │      (Earning entity, idempotent)
   ai-pipeline   ─▶ │  ├─ _settle() ──▶ markSettled()    │   │
   foreman       ─▶ │  │                                  │   │ ──▶ data/revenue-engines/run-*.json
   shipstack     ─▶ │  └─ _status()                       │   │      (full run report)
   applypilot    ─▶ │                                         │
                    └─────────────────────────────────────────┘
                                              │
                                              ▼
                            Existing payout pipeline picks up
                            pending_settlement earnings and
                            routes them to PayPal / Bank / Crypto
                            via the reconciled payout workflow
```

## Verification (all tests passed locally)

| Test | Scenario | Result |
|---|---|---|
| 1 | `registry.mjs list` — dynamic engine discovery | 8 engines registered ✓ |
| 2 | `registry.mjs run haio-solana` (observe mode) | Earning emitted to store ✓ |
| 3 | Re-run same engine — idempotency check | No duplicate earnings ✓ |
| 4 | `registry.mjs run-all` (all 8 engines, observe mode) | 8/8 ok, 0 partial, 0 fatal ✓ |
| 5 | Earning records persisted with correct schema | All 8 records match existing schema ✓ |
| 6 | Run report written to `data/revenue-engines/run-latest.json` | Confirmed ✓ |

Sample earning emitted by `haio-solana` engine:

```json
{
  "id": "offline_Earning_HAIO_stub_inflow_1785436389303",
  "earning_id": "HAIO_stub_inflow_1785436389303",
  "amount": 1,
  "currency": "USDC",
  "source": "haio-solana",
  "beneficiary": "TestSafe",
  "status": "observe_only",
  "metadata": {
    "signature": "stub",
    "from": "stub_source",
    "block_time": 1785436389,
    "planned_burn_pct": 10,
    "planned_operational_pct": 20,
    "engine": "haio-solana",
    "engine_version": "0.1.0",
    "mode": "observe"
  }
}
```

## How to apply

### Option A — one-shot apply script

```bash
cd /path/to/your/Nouveau-dossier-3-clone
bash /home/z/my-project/download/revenue-engines-bundle/apply.sh
git add -A
git commit -m "feat(revenue-engines): add 8 new revenue engines (HAiO x4 + ncklrs x4)"
git push origin main
```

### Option B — manual copy

```bash
cp -r /home/z/my-project/download/revenue-engines-bundle/src/revenue-engines  /path/to/repo/src/
cp /home/z/my-project/download/revenue-engines-bundle/.github/workflows/revenue-engines.yml  /path/to/repo/.github/workflows/
```

## Enabling each engine (from observe → live)

Engines ship in **observe mode** by default — they discover opportunities and emit earnings with `status: observe_only` but never move funds. To enable live mode for an engine:

1. **Set the required secrets in GitHub** (repo → Settings → Secrets and variables → Actions). Each engine's required env vars are documented at the top of its adapter file and in the workflow YAML.

2. **Run a single engine in live mode** (workflow_dispatch):
   - Go to Actions → "Revenue Engines Sweep" → Run workflow
   - Set `engine` to the engine name (e.g. `haio-solana`)
   - Set `mode` to `live`

3. **Or enable live mode globally** by setting `REVENUE_ENGINE_MODE=live` as a repo variable — but **only do this after verifying each engine individually**.

### Secret checklist per engine

| Engine | Required secrets |
|---|---|
| `haio-solana` | `HAIO_AGENT_WALLET`, `HAIO_RPC_URL`, `HAIO_REVENUE_SAFE`, `SOLANA_PRIVATE_KEY` (+ optional `HAIO_BURN_PCT`, `HAIO_OPERATIONAL_PCT`) |
| `haio-tx-gateway` | `HAIO_TX_GATEWAY_PROGRAM`, `HAIO_RPC_URL`, `HAIO_TREASURY_WALLET` |
| `haio-agent-nft` | `HAIO_AGENT_NFT_ADDRESS`, `HAIO_EVM_RPC_URL`, `HAIO_FEE_RECIPIENT`, `EVM_PRIVATE_KEY` |
| `haio-vesting` | `HAIO_VESTING_PROGRAM`, `HAIO_RPC_URL`, `HAIO_VESTING_RECIPIENT` |
| `aipipeline-router` | `AIPROFILE_USAGE_LOG_PATH`, `AIPROFILE_PRICING_TABLE_PATH` (paths to files in repo or mounted volume) |
| `foreman-coding` | `FOREMAN_TASK_LEDGER_PATH`, `FOREMAN_RATE_CARD_PATH` |
| `shipstack-pr` | `SHIPSTACK_PR_LEDGER_PATH`, `SHIPSTACK_RATE_CARD_PATH` |
| `applypilot-jobs` | `APPLYPILOT_LEDGER_PATH` |

## Safety notes

- **All engines are observe-only by default.** No funds move unless `REVENUE_ENGINE_MODE=live` is set AND the engine's required secrets are present.
- **Even in live mode**, the HAiO Solana and EVM adapters are stubs that log intent but do NOT broadcast transactions. You must wire up the real program calls (using `@solana/web3.js` / `ethers`) before live mode will actually move funds. The adapter files document exactly where to add this code.
- **The 4 SaaS engines** (aipipeline-router, foreman-coding, shipstack-pr, applypilot-jobs) read usage ledgers and emit earnings, but settlement always routes through the existing payout pipeline (PayPal/Bank/Crypto) — they never move funds directly.
- **Idempotency is guaranteed.** Each earning has a deterministic `earningId` (e.g. `HAIO_inflow_<signature>` or `FOREMAN_task_<task_id>`). Re-running an engine never duplicates earnings.
- **The scheduled workflow runs every 30 minutes** in observe mode by default. To change the schedule, edit the `cron` line in `.github/workflows/revenue-engines.yml`.

## What's NOT included

- **`@solana/web3.js` and `ethers` are optional deps.** The adapters gracefully degrade to stub mode if these packages aren't installed. To install them: `npm i @solana/web3.js ethers` (they're already listed as `optionalDependencies` in the CI fix bundle's `package.json`).
- **No live on-chain program calls.** The HAiO adapters detect events and emit earnings, but the actual swap/burn/distribute instructions are stubbed. You must implement these by following the adapter file's inline documentation.
- **No new payout rails.** All settlement still flows through the existing PayPal/Bank/Crypto/ChariBaaS pipeline that was reconciled in the previous task.
