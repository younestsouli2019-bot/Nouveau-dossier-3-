# Deployments & Live Endpoints

This is the canonical registry of live swarm/base44 deployments. The actual revenue / payout
machinery is deployed as Base44 apps (`*.base44.app`) fronted by `space-z.ai` public URLs,
plus the Vercel supply-chain front-end.

## Status Snapshot (2026-08-29)

| Component | Status | Notes |
|-----------|--------|-------|
| Next.js build (`npm run build`) | ✅ PASS | 3 static pages + 50+ API routes, exit 0 |
| Prisma schema | ✅ PASS | RevenueLedgerEntry ↔ LedgerAccount relation fixed |
| Truth Guards (TRUTH-001…006) | ✅ INSTALLED | Prisma middleware; 6 rules flag any completed-status record without external proof |
| Vercel domain (`supply-chain-swarm.vercel.app`) | ✅ LIVE | Older 7-tab deployment (Accounts/Dashboard/Payments/Orders/Shipments/Procurement) — needs redeploy from latest code |
| Vercel project (`supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app`) | 🔐 SSO-GATED | Redirects to Vercel login; must be redeployed via `deploy-vercel.yml` workflow with VERCEL_TOKEN |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ⚠️ DOWN / RECYCLED | ERR_INVALID_RESPONSE / 502 — consistent with Z.ai project expiry-recycle. Not a code fault. See **Z.ai Recycle Remediation** below. Redeploy via Space-Z dashboard (no SPACEZ_TOKEN in-repo). |
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ LIVE | SWARM_LIVE=true · NO_PLATFORM_WALLET=true · Owner payouts direct |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ✅ LIVE | Full 21-tab feature set (Swarm Ledger · Audit · Learning · Crypto · Execution · Payouts · Swarm Sync · Vault · Deploy · Resilience · Architecture · Base44 · Pipeline · Custodian) |
| Procurement optimization engine | ✅ CODE READY | 5-phase dedup + local Morocco sourcing (70–88% price factors) + bulk discounts (5–15%) |
| Course media (realworldcerts.com) | 🛑 BLOCKED | 302/302 courses FAIL media contract. Missing: IMAGE_GEN_API_KEY, VIDEO_GEN provider key, ASSET_BASE_URL pub host |

## Primary deployment roster

### Space-Z deployments (Alibaba Cloud Function Compute)

| URL | App | Base44 API / Scope | Status 2026-08-29 | Priority |
|-----|-----|-----------|-------------------|----------|
| https://x1he4604ap01-deploy.space-z.ai/ | **HIT Swarm · Autonomous Revenue Engine** | agent-swarm.base44.app | ❌ **DOWN** (ERR_INVALID_RESPONSE). Last deployed July 27 d4da1e2. Never ran a tick. | **P0 — REDEPLOY NOW. Revenue cannot flow without this engine online.** |
| https://b1fx661hzse0-d.space-z.ai/ | **AgentFlow AI Command Center (AICC)** | https://agent-flow-ai-9855ea98.base44.app/api | ✅ LIVE · initializing. Truth-Only UI: ON · NO_PLATFORM_WALLET=true · SWARM_LIVE=true. Modules: Payment Ops · Revenue · Swarm · Missions · Campaigns · WET-RUN · Auto-Remediation · E-Commerce Swarm · Revenue Split · Fusion Engine. | P1 |
| https://t1trn6kunnv1-d.space-z.ai/ | **Supply Chain Main · 21 tabs** | Procurement · Shipments · Payments · Tracking · Payouts · Swarm Sync · Vault · Audit · Learning · Crypto · Execution · Deploy · Resilience · Architecture · Base44 · Pipeline · Custodian · plus 7 base tabs. Deploy webhook at `/api/webhook/deploy`. | ✅ LIVE | P1 |

### Vercel deployments (Next.js — source: this repo, main branch)

| URL | App | Scope | Status 2026-08-29 | Priority |
|-----|-----|-------|-------------------|----------|
| https://supply-chain-swarm.vercel.app/ | **Supply Chain · Public domain** | 7 base tabs: Accounts / Dashboard / Payments / Orders / Shipments / Procurement. Footer: "Supply Chain Management — Younes Tsouli CIN:A337773 · All items pre-paid by Swarm · Recipients do not disburse". | ✅ LIVE, OUTDATED. Missing 14 tabs vs t1trn6kunnv1. Trigger `deploy-vercel.yml` now. | **P0 — UPDATE DEPLOYMENT.** |
| https://supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app/ | Vercel internal project URL (team: jonas-projects-ca14fe2e) | Same app as `supply-chain-swarm.vercel.app` (project alias). | 🔐 SSO — redirects to Vercel login. Redeploy via CI with VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID secrets. | P1 |

## 3 Procurement Recipients (PO addresses — ALL ITEMS PRE-PAID BY SWARM)

Sourced from `procurement.txt` in repo root. Every item ships pre-paid; recipients disburse $0.
Optimization engine (5-phase pipeline in `src/lib/procurement/optimization.ts`) re-routes import items to cheaper **Moroccan local suppliers** (70–88% factors) automatically on each run. Trigger via `POST /api/procurement/optimize`.

| # | Recipient Name | Delivery Address | Tel | Procurement categories (key items) | Local sourcing discount appied |
|---|----------------|------------------|-----|------------------------------------|--------------------------------|
| 1 | **Mrs Hind Tsouli** | Etage 2 JASMIN II, IMM H3, APPT 21, SIDI-YAHYA-ZAÏR, 12150, Morocco | 0602680629 | Samsung 43" UHD Smart TV (UA43U8000FUXM) · Samsung 2.0 Soundbar (HW-B400F/MV) · 1080P+720P dash cam (170° + night-vision + 24h parking mode + G-sensor) · 5-in-1 electric rotary cleaning brush (USB rechargeable) · High-pressure washer foam gun (2X spray + car/plant/cleaning/inflate) | Electrocity Morocco 88% · Home Decor Casablanca 75% · Local Electronics Bazaar 80% |
| 2 | **Mr Younes Tsouli** | Lot. Rita, LOT C, Immeuble B, Appartement 17, BOUZNIKA, Casablanca-Settat 13100, Morocco | — | 2× Dell Precision 3541 (4TB) · Winston Filter Soft ×20 · Panter Mignon ×5 · Panter Café Crème Original ×5 · Camel Yellow Soft Filters ×5 · Café Pur Arabica 1kg Bali ×3 · Mini-Bar « ELEXIA » RM004 (48×52×41 cm, 600 DH/1–2j) · Samsung 65" UHD Smart TV (1 250 DH) · Kit Pause Café Gold (1 700 DH HT, via integral-location.ma) · Mini-PC + monitor (value/performance) · Shop surveillance security cameras · Fresh Moroccan vegetables pack · 5 kg fresh fish pack minimum · Kricely trail shoes EU49 / US13 ×2 (yellow + camouflage) · Brandit M-65 Giant Jacket (Olive, 2XL) · Mil-Tec US Tactical Flight Jacket (Black, 2XL) · Kitchen anti-splash backsplash guards ×8 · Football fan sticker packs (54pc + 50pc + 50pc) · 4-in-1 wall-mounted creative storage (ashtray/trash can, non-drill, 4pc) ×2 · Creative Black ashtray ×1 · Camera accessory kits (4/5/15/25/30/55/75/95/110 pc) ×2 · Mini 2G dual-SIM backup phone (outdoor/cycling/elderly) · Compact folding pocket knife + keychain · 2× 3D ergonomic box openers · 3× marbled waterproof self-adhesive PVC wallpaper rolls (500×40 cm) · OnePlus 15 5G smartphone · Natural nitric-oxide boosters (superfood.ma) + diabetes pack · Crest 3D Whitestrips Professional Effects + Opalescence Go (dentist-grade peroxide) · Wholesale consumer electronics (Temu/AliExpress $10-or-less catalogue: mice, flash drives, solar banks, BT earbuds, USB-C cables, chargers, BT speakers, LED lamps, phone holders, smartwatch bands, USB hubs, cooling pads, IR thermometers, LED strips, rechargeable AA/AAA, mini fans, BT finders, laser pointers, UV sanitizers, foldable BT keyboards, screen magnifiers, digital scales, gimbals, LED readers, SSD enclosures, FM radios, phone cleaning kits, BT lav mics, dictaphones, cable organisers, FM transmitters, touchscreen gloves, BT car kits, kitchen timers, cable clips, travel power-strips, mini tripods + remotes, USB hand-warmers, airpod cases, hygrometers, RFID wallets, BT receivers — 50+ SKUs | Outdoor Gear Rabat 82% · Gift Shop Agdal 70% · Tech Souk Sidi Yaacoub 78% · SuperFood Local 88% · Parfumerie Agdal 85% · Local Electronics Bazaar 80% · Home Decor Casablanca 75% · Electrocity Morocco 88% · Plus qty-tier bulk discounts: 5% @5, 10% @10, 12% @15, 15% @20+ |
| 3 | **M Bachir Tsouli** | 45 Avenue Ibn Sina, Appartement 4, Agdal, Rabat, Morocco | — | Tablet CR 10.1" Android 16 2-in-1 GMS Tab · Paco Rabanne + Montblanc Legend perfumes · Premium stylish orthopaedic cane · Premium orthopaedic slippers · SuperFood.ma nitric-oxide production natural pack + diabetes pack | Medical Supply Rabat 82% · Parfumerie Agdal 85% · SuperFood Local 88% |

### Pre-paid guarantee
Footer on every deployed page reads: **"Supply Chain Management — Younes Tsouli CIN:A337773 · All items pre-paid by Swarm · Recipients do not disburse"**. This is enforced by `page.tsx` layout and cannot be overridden per-PO in the UI.

### Local supplier roster (Morocco)
Defined in `src/lib/procurement/optimization.ts` → `LOCAL_SUPPLIERS`. Price factor = final price as % of import baseline.

| Supplier | Pattern match | Price factor |
|----------|---------------|--------------|
| Local Electronics Bazaar | phone · cable · charger · usb · bluetooth · earbuds · speaker · led · holder · cooling | 0.80 (20% off) |
| Home Decor Casablanca | kitchen · sink · splash · wallpaper · ashtray · storage · cushion | 0.75 (25% off) |
| Outdoor Gear Rabat | shoes · jacket · pocket knife · trail · m-65 | 0.82 (18% off) |
| Gift Shop Agdal | sticker · football · creative | 0.70 (30% off) |
| Tech Souk Sidi Yaacoub | camera · accessories · 3d box | 0.78 (22% off) |
| SuperFood Local | food · fish · legumes · nac · whitening · whitestrip · opalescence · diabetes · nitric · natural | 0.88 (12% off) |
| Parfumerie Agdal | perfume · cologne · paco · rabanne | 0.85 (15% off) |
| Medical Supply Rabat | tablet · cane · slipper · orthopedic | 0.82 (18% off) |
| Electrocity Morocco | tv · samsung.*tv · television · soundbar · dash cam | 0.88 (12% off) |

## Owner Pre-Set Payout Accounts (5 rails)

Defined in `scripts/seed-pos.mjs` · all 5 routes are pre-seeded. Live destinations for auto-disbursement.

| Label | Rail | Currency | Recipient / Identifier | Primary | Purpose |
|-------|------|----------|------------------------|---------|---------|
| Banking Circle — Primary | bank_wire (Wise) | USD | Banking Circle S.A. · LU · Swift BCIRLULL · Account last-4 **646** | ✅ YES | settlements · vendor_payments |
| PayPal Business | paypal | USD | younestsouli2019@gmail.com (Business, MA) | — | general · settlements |
| USDC on Arbitrum | l2_crypto | USD | Wallet `0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7` · Chain 42161 · Token USDC | — | crypto_settlement · general |
| Payoneer — Supplier Payments | payoneer | USD | younestsouli2019@gmail.com | — | vendor_payments |
| Moroccan Bank — RIB 372 | bank_wire (Attijariwafa) | MAD | Attijariwafa · MA · Account last-4 **372** · RIB `007810000448500030594182` | — | salary · general |

### Fixed revenue split policy (from OwnerPaymentConfig)

| Bucket | Split % | Routing destination |
|--------|---------|---------------------|
| Salary (10% per prior profile × 4 =) | **40%** | Attijariwafa Bank — RIB 372 |
| Debt repayment | **40%** | Banking Circle Primary + PayPal Paydown (from settlement pool) |
| Revenue settlements | **30%** ← overrides prior when split conflicts are resolved at runtime | Banking Circle Primary (Wise) |
| Infrastructure | **20%** | Internal pool (server / APIs / hosting) |
| Emergency reserve | **10%** | Internal pool |

Note: The regulatory pipeline in `settlement-engine.ts` first deducts platform fee (OWNER_PAYOUT_FEE_BPS basis points) + chargeback reserve % + fraud-window hold hours, then routes the NET amount to the splits above. `autodisbursetopresetowner` is **true by default** per Owner Directive 2026-08-20.

### Wise rail readiness (from `reconciliation-flag-2026-08-28.json`)
- **`OWNER_WISE_API_TOKEN`**: verified valid (HTTP 200)
- Target Wise account: `73c0818e-6405-4645-abda-5046453370eb`
- Bank: Banking Circle, Luxembourg (LU7740800…)
- A genuine funded RevenueEvent is the missing input — rails are ready to disburse the moment real revenue is externally proved.

### Current honest payout balance
| Item | Value |
|------|-------|
| Base44 RevenueEvents `cancelled` | 85 / 158 |
| Outbound OwnerSettlements "completed" with externalRef=null (UNVERIFIED) | 17, sum $6 414.05 |
| Payout batches "processing" with duplicate proof (single ATTIJARI RIB ref reused for 4 distinct $37 313.25 batches → ~$149k claimed, 0 PayPal batch_id, 0 items) | 4 batches, FLAGGED UNVERIFIED by reconciliation |
| Authorizer ledger (`4000-Owner-Payable`) | $0.00 |

## RealWorldCerts course media (www.realworldcerts.com)

Audited 2026-08-27 by `scripts/rwc-course-media-audit.mjs` → `data/out/course-media-audit.json`.

| Metric | Value |
|--------|-------|
| Courses audited | 302 |
| Pass (media contract) | 0 |
| Fail | 302 (100%) |
| Publishing status | 🛑 BLOCKED (MEDIA_CONTRACT_FAILED) |
| Sample pass: hero_image required=1 | found=0 / 302 |
| Sample pass: thumbnail required=1 | found=0 / 302 |
| Sample pass: module_images required=3 | found=1 / 302 partial (33%) |
| Sample pass: diagrams required=2 | found=0 / 302 |
| Sample pass: trailer_video required=1 | found=0 / 302 |
| Sample pass: lesson_videos required=3 | found=0 / 302 |
| Sample pass: cheat_sheet required=1 | found=0 / 302 |

### Required secrets to unblock media generation
From `scripts/course-video-producer.mjs`:

| Env var | Where to get | Purpose |
|---------|-------------|---------|
| `IMAGE_GEN_API_KEY` | https://api.together.xyz/ (or any FLUX.1-schnell provider) | Hero/thumb/module/diagram/cheat image generation (FLUX.1-schnell default, 4 steps) |
| `VIDEO_GEN_API_KEY` **or** `REPLICATE_API_TOKEN` **or** `GOOGLE_AI_STUDIO_KEY` | Replicate / Google AI Studio / Runway | Course trailer & lesson videos. FAIL-CLOSED: `buildVideos()` throws explicitly if missing (no placeholder fabrication). |
| `ASSET_BASE_URL` **or** `ASSET_UPLOAD_URL` | R2 / S3 / Supabase Storage / Vercel Blob / CDN | Public host so the generated media URLs return HTTP 200. `storagePublish()` fail-closed if empty. |

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/course-video-producer.mjs --all` | Generate every missing asset (hero, thumb, module, diagram, cheat, trailer, lesson videos) per media contract. Writes to `data/generated/` + registry `data/out/course-asset-registry.json`. |
| `scripts/generate-course-posters.mjs` | SVG fallback banner posters. Does NOT require an API key. Produces `.svg` thumbnails (used as partial stopgap 1/3 for module_images). |
| `scripts/rwc-site-assets.mjs` | Inject SVG banner assets into `.vercel/output/static/assets/courses/` for the catalogue. |
| `scripts/rwc-course-media-audit.mjs` | Re-audit www.realworldcerts.com; writes updated `course-media-audit.json`. |
| `scripts/rwc-verify-site.mjs` | Smoke-check live RWC pages. |
| `scripts/rwc-checkout-pages.mjs` | Build RWC checkout static pages. |

## 5-Layer CORE-Protect

Still active on 48 critical files (vault scripts, CI workflows, daemons, settlement engine). Edits **require**:
1. `scripts/guard/apply-attrib-readonly.ps1 -Clear` (drop FS read-only bits)
2. Make edits
3. `scripts/guard/verify-core.ps1 -Init` (recompute SHA-256 manifest)
4. `scripts/guard/apply-attrib-readonly.ps1` (re-apply read-only + hook)
5. Git commit subject line begins **`[CORE-UPDATE]`** — else pre-commit + CI gates reject.

## Deployment workflows (GitHub Actions)

| Workflow | Trigger | Purpose | Required repo secrets |
|----------|---------|---------|-----------------------|
| `.github/workflows/deploy-vercel.yml` | push main · workflow_dispatch (prod / preview) | **NEW 2026-08-29.** Build + deploy to Vercel → `supply-chain-swarm.vercel.app`. Runs `/api/healthz` post-deploy verification. Posts procurement optimization checklist in summary. | `VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` · `DATABASE_URL` |
| `.github/workflows/deploy-space-z.yml` | push main · workflow_dispatch (5 instance choices: main-app · hit-swarm · payout-recovery · trace-platform · agentflow) | Verify secrets, build Next.js, output artifact, print Space-Z redeploy instructions (Alibaba Cloud FC). | `BASE44_API_KEY` · `BASE44_SERVICE_TOKEN` · `DATABASE_URL` |
| `.github/workflows/deploy-pages.yml` | push main | GitHub Pages static output. | (default GITHUB_TOKEN) |

## What to do RIGHT NOW (P0 → P1 priority)

### P0: Unblock revenue and Vercel domain update
1. **Redeploy HIT Swarm (`x1he4604ap01`)** — see **Z.ai Recycle Remediation** below. Space-Z dashboard → instance x1he4604ap01-d → Redeploy / Fetch Latest Commit. Once back online: open dashboard → flip **Autopilot ON** OR click **Run tick**. Tick result must produce a RevenueEvent with external proof (not manual_attestation).
2. **Redeploy Vercel `supply-chain-swarm.vercel.app` from latest code.** Either (a) push main with VERCEL secrets set → `deploy-vercel.yml` runs, or (b) Vercel dashboard → Project → Deployments → "Redeploy" on latest. Post-deploy: verify 7 tabs render, hit `/api/healthz` → 200, click Dashboard → **Fix All Routing** (resolves the banner: "$0.00 trapped in Banking Circle / Operational Pool. Salary routing was never configured to reach owner RIB.").
3. In GitHub repo secrets, set: `VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` so the new `deploy-vercel.yml` can deploy on every main push.

### Z.ai / Base44 project expiry & recycle remediation (template)

Applies to any `*.space-z.ai` / `*.base44.app` workspace that gets recycled mid-task (HIT Swarm `x1he4604ap01` is the current example).

1. **Architectural guardrails (implemented in code, `swarm-ops-project`):**
   - **Append-only event logging** — `src/lib/journal/append-only.ts`: every daemon tick writes a write-once, hash-chained (`prev → entryHash`) JSONL line to `data/swarm/journal/journal.jsonl` (gitignored, durable, survives mid-task disconnect). Wired into `src/app/api/swarm/daemon/route.ts` (journal entries for start / completed / failed). No update/delete API exists — the file is only ever opened with append flag.
   - **Execution isolation** — daemon refuses deploy/delivery writes when `PLAN_TRANSITION_MODE=1` (assessment-only run: reconcile + guard + fusion). This prevents a recycled workspace from writing into the base environment during an active plan-transition phase. Nothing must run against base env in write mode during transition.
2. **GLM-5.3 configuration (for Z.ai-hosted runtimes, set at redeploy):** GLM-5.3 must be initialized with `thinking: "enabled"` and `reasoning_effort: "low"` — starting it with thinking disabled causes an immediate API handshake failure:
   ```json
   { "model": "glm-5.3", "thinking": "enabled", "reasoning_effort": "low" }
   ```
   The local `src/lib/dynamic-router.ts` catalog routes via OpenRouter and does NOT host a GLM-5.3 entry; upgrade your recycled Z.ai projects to the GLM-5.3 runtime using the params above.
3. **Recycle the recovered workspace safely** — preflight: journal enabled; set `PLAN_TRANSITION_MODE=1`; run a tick; verify `reconcile` + guard + fusion produce output; THEN set `PLAN_TRANSITION_MODE=0` and let deploy/delivery resume.
4. **Fallback: local inference redundancy (Phase 4).** If a Z.ai/Base44 project cannot be recovered (expired credits / no dashboard access), the workspace can be reconstructed locally with open-weight models so revenue machinery never depends on a single vendor:
   - Pull `GLM-5.3-Flash` weights from HuggingFace;
   - Run offline via vLLM / SGLang (or OpenClaw for agent tooling);
   - Point the swarm's LLM router at the local endpoint (`OPENROUTER_BASE` override or a `local://` model entry);
   - Data governance shifts back to private bare-metal, eliminating project-expiry risk.

### P1: Procurement + Payouts + Course Media
4. **Seed 3 recipients into the DB if not present.** Run `npm run db:seed-pos` → seeds 8 POs, 5 suppliers, 5 owner accounts, 4 split configs, 5 revenue events. Then `POST /api/procurement/seed-workflow` → recipients from `procurement.txt` are loaded. Then `POST /api/procurement/fix-recipients` → dedup + cross-link POs to each of the 3 recipients. Then `POST /api/procurement/optimize` → local Morocco suppliers kick in (70–88% price cuts + qty-tier bulk discounts). Footer banner confirms pre-paid status for all 3 recipients.
5. **Owner Payouts.** When HIT Swarm tick #1 lands with externally-proven revenue of any amount > $0.01:
   - `POST /api/settlements/settle-and-payout` with `{ revenueEventId, amount, currency, sourceType, sourceRef }` → calls `settleAndPayout()` in `src/lib/payout-routing.ts`.
   - Net routes via the 5 owner accounts in fixed splits (Salary 40% → Attijari RIB 372; Settlements 30% → Banking Circle; etc).
   - Wise rail is READY (token valid). For PayPal: `owner-payout-paypal.mjs` submits a real batch with `paypal_batch_id` (TRUTH-004 enforced, no fabricated `processing`).
   - For Attijari MAD payouts: `scripts/approve-bankwire.js` → `POST /api/attijari` → MT103 rail, verified by `scripts/watch-bank-wire.mjs`.
6. **RWC course media.** Set 3 env vars: `IMAGE_GEN_API_KEY` (Together) + any of `VIDEO_GEN_API_KEY` / `REPLICATE_API_TOKEN` / `GOOGLE_AI_STUDIO_KEY` + `ASSET_BASE_URL` (pub CDN). Then run:
   ```
   node scripts/course-video-producer.mjs --all --images --videos
   node scripts/rwc-course-media-audit.mjs
   ```
   Audit should flip to 302/302 PASS. Publishing auto-unblocks (MEDIA_CONTRACT gate).

### P2: Steady-state
7. Set `OWNER_KYC_STATUS=PASSED` explicitly in secrets (live disbursement gate in `settlement-engine.ts` Stage 1 `VERIFY_COMPLIANCE`).
8. Onboard the 9 Morocco local supplier entries into `Supplier` table with their payment terms so the optimization-engine re-routes are backed by real POs, not just price annotation.
9. Add www.realworldcerts.com to Vercel project domains (vercel.json → `domains` array) after course media passes audit.
10. Mirror the Vercel deploy to the other 2 Space-Z endpoints so all 3 public UIs (b1fx661 · t1trn6kun · supply-chain-swarm.vercel.app) are in sync.
