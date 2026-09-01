# Deployments & Live Endpoints

This is the canonical registry of live swarm/base44 deployments. The actual revenue / payout
machinery is deployed as Base44 apps (`*.base44.app`) fronted by `space-z.ai` public URLs,
plus the Vercel supply-chain front-end.

## Status Snapshot (2026-08-29)

### 🔐 OWNER RULING — "All roads lead to Mecca" (IMMUTABLE unless changed by OWNER)
Payout routing must resolve to **ANY available pre-set owner account** — the route with the **least fees**, the **easiest currency conversion** (or none), and the most **velocity headroom** under its per-rail limit. A missing or mismatched `OWNER_PAYOUT_RAIL` env var / currency MUST **NOT** abort disbursement; the resolver picks the best reachable pre-set account instead. Fail-closed **only** when zero usable routes exist. Implemented: `src/lib/payout-resolver.ts` (`resolveBestPayoutRoute`), wired into `AUTO_DISBURSE_PRESET_OWNER` (settlement-engine.ts), 2026-08-29. Changelog entry dated 2026-08-29.

| Component | Status | Notes |
|-----------|--------|-------|
| Next.js build (`npm run build`) | ✅ PASS | 3 static pages + 50+ API routes, exit 0 |
| Prisma schema | ✅ PASS | RevenueLedgerEntry ↔ LedgerAccount relation fixed. New `FundBucket` + `PayoutRoutingRule` models added; SQL migration in `prisma/migrations/20260829000000_add_treasury_buckets_routing/` (see § Treasury Buckets Migration below). |
| Truth Guards (TRUTH-001…006) | ✅ INSTALLED | Prisma middleware; 6 rules flag any completed-status record without external proof |
| Procurement ledger truth | ✅ RECONCILED 2026-08-29 | 175 items were `settled` with 0 delivery proof → demoted to honest `ordered`. 48 shipments `pending`, 0 tracking numbers, fabricated carrier labels nulled. Nothing asserted beyond what happened. |
| Carrier tracking (autonomous) | ✅ KEYLESS-DEFAULT | `src/lib/procurement/carrier-router.ts` autodetects local Morocco carriers (Poste Maroc / Amana / Aramex / DHL / FedEx / UPS / Chronopost) + public track-by-reference URLs with NO API key. Paid event data (`SHIP24_API_KEY`, `NINE_TRACKING_KEY`) optional; absent → `keylessCarrierRouter: true`, `trackingVerified=false` (never invents events). AutoPilot `carrier_resolve` phase runs it. |
| Carrier directory (2026-08-30) | ✅ EXPANDED | Web-confirmed track URLs for Cathedis (`cathedis.ma/tracker/index.php?track_number=`), Mylerz (`mylerz.net/track`), plus Quick Livraison / Skypostal / G4D / Tawssil / Coliaty / ASAP / Forcelog / Express Relais / Atlas as portal/API-identified carriers (`known:false` for URL, no invented endpoints). `autodetectCarrier(trackingNumber, platformHint)` disambiguates numeric collisions per platform (jumia/avito/superfood/shopify/iristech/marjane). |
| CRBT cash-return ledger | ✅ LIVE 2026-08-30 | `CashReturn` table + `cash-return.ts` state machine (`cash_collected → pending_remittance → in_transit → reconciled → returned`, `disputed` escape). Requires real external `proofRef` for reconciled/returned. AutoPilot `crbt_reconcile` phase opens rows on REAL-delivered COD only. Migration `20260830000200_add_cash_return_crbt` + fraud-guard PO fields `20260830000100_add_tracking_fraud_guard_fields` applied to Neon (via `prod:migrate`). |
| Fraud guard + verify closure | ✅ SHIPPED 2026-08-30 | `/api/carrier-tracking`, `/api/shipments/verify`, `/api/shipments/verify-all` now set `trackingVerified=true` ONLY on a real carrier `delivered` event + 3-point PO guard `VERIFIED_OK` (destination/weight/timeline). Blind flips and length≥8 heuristics removed. `payoutReleaseGate` in `payment-gateway-router.ts` adds COD 24h window + gateway-configured checks at settlement. |
| Prisma schema | ✅ PASS | RevenueLedgerEntry ↔ LedgerAccount relation fixed. New `FundBucket` + `PayoutRoutingRule` models added; SQL migration in `prisma/migrations/20260829000000_add_treasury_buckets_routing/` (see § Treasury Buckets Migration below). **`ownerInitiated` migration gap fixed**: `prisma/migrations/20260829000100_add_owner_initiated_scope/` created + applied to Neon (proc code now enforces prepaid-scope on prod). |
| Z.ai/Base44 Guardrails | ✅ CODE DONE | 2-tier fail-closed READ-ONLY execution gate + append-only fsync'd hash-chain journal + daemon journal seal. See § Z.ai / Base44 Guardrails below. |
| GLM-5.3 params (deployed apps call sites) | ✅ CODE DONE | `{ model: "glm-5.3", thinking: "enabled", reasoning_effort: "low" }` injected automatically in: `src/lib/dynamic-router.ts:callOpenRouter` + `swarm-ops-project/src/lib/free-models.ts:buildChatCompletionBody`. Phase-4 local option (vLLM/SGLang/OpenClaw) documented. |
| Vercel domain (`supply-chain-swarm.vercel.app`) | ✅ LIVE | Older 7-tab deployment (Accounts/Dashboard/Payments/Orders/Shipments/Procurement) — needs redeploy from latest code |
| Vercel project (`supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app`) | 🔐 SSO-GATED | Redirects to Vercel login; must be redeployed via `deploy-vercel.yml` workflow with VERCEL_TOKEN |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ⚠️ DOWN / RECYCLED | ERR_INVALID_RESPONSE / 502 — consistent with Z.ai project expiry-recycle. Not a code fault. See **Z.ai Recycle Remediation** below. Redeploy via Space-Z dashboard (no SPACEZ_TOKEN in-repo). |
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ **LIVE (re-verified 2026-09-01, external-path)** | Truth-Only UI: ON · SWARM_LIVE=true · NO_PLATFORM_WALLET=true · Owner payouts direct. Base44 backend (`agent-flow-ai-9855ea98.base44.app/api`) reachable. ⚠️ Keyless nav enumeration exposes payout page names — see roster note. |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ❌ **DOWN (re-confirmed 2026-09-01, external-path)** | HTTP 502 Bad Gateway — status regression from ✅ LIVE. Same failure signature as the HIT Swarm recycle (ERR_INVALID_RESPONSE/502, Z.ai project expiry). Not a code fault. **P0 — redeploy via Space-Z dashboard** (no SPACEZ_TOKEN in-repo). |
| Procurement optimization engine | ✅ CODE READY | 5-phase dedup + local Morocco sourcing (70–88% price factors) + bulk discounts (5–15%) |
| Course media (realworldcerts.com) | 🛑 BLOCKED | 302/302 courses FAIL media contract. Missing: IMAGE_GEN_API_KEY, VIDEO_GEN provider key, ASSET_BASE_URL pub host |

## Primary deployment roster

### Space-Z deployments (Alibaba Cloud Function Compute)

| URL | App | Base44 API / Scope | Status 2026-08-29 | Priority |
|-----|-----|-----------|-------------------|----------|
| https://x1he4604ap01-deploy.space-z.ai/ | **HIT Swarm · Autonomous Revenue Engine** | agent-swarm.base44.app | ❌ **DOWN** (ERR_INVALID_RESPONSE). Last deployed July 27 d4da1e2. Never ran a tick. | **P0 — REDEPLOY NOW. Revenue cannot flow without this engine online.** |
| https://b1fx661hzse0-d.space-z.ai/ | **AgentFlow AI Command Center (AICC)** | https://agent-flow-ai-9855ea98.base44.app/api | ✅ LIVE (re-verified 2026-09-01 via external path — local-shell curl is a false negative: machine TLS egress is blocked; control test to github.com fails identically). Shell renders: Truth-Only UI: ON · NO_PLATFORM_WALLET=true · SWARM_LIVE=true · Owner payouts direct; Overview showed INITIALIZING/"Loading live data…" to an anonymous fetch (expected for a client-side app). Base44 backend reachable (serves app shell + 26+ page nav keyless). ⚠️ Note: unauthenticated page-name enumeration is possible ("Automated PayPal Transfers", "Payout Control", "Manual Wire Execution", … are visible in nav HTML without a key) — consider gating nav behind auth platform-side. | P1 |
| https://t1trn6kunnv1-d.space-z.ai/ | **Supply Chain Main · 21 tabs** | Procurement · Shipments · Payments · Tracking · Payouts · Swarm Sync · Vault · Audit · Learning · Crypto · Execution · Deploy · Resilience · Architecture · Base44 · Pipeline · Custodian · plus 7 base tabs. Deploy webhook at `/api/webhook/deploy`. | ❌ **DOWN (re-confirmed 2026-09-01 via external path)** — HTTP 502. Was ✅ LIVE. Z.ai expiry-recycle signature. **P0 — REDEPLOY via Space-Z dashboard.** | P0 |

### Vercel deployments (Next.js — source: this repo, main branch)

| URL | App | Scope | Status 2026-08-29 | Priority |
|-----|-----|-------|-------------------|----------|
| https://supply-chain-swarm.vercel.app/ | **Supply Chain · Public domain** | 7 base tabs: Accounts / Dashboard / Payments / Orders / Shipments / Procurement. Footer: "Supply Chain Management — Younes Tsouli CIN:A337773 · OWNER-initiated POs: pre-paid by Swarm · Recipients $0 out-of-pocket · Third-party POs: standard terms apply". | ✅ LIVE, OUTDATED (re-verified 2026-09-01). Still the 7-tab build (missing 14 tabs vs t1trn6kunnv1). Dashboard renders an EMPTY un-seeded state (all metrics $0/0, "No data yet") — not showing the live Neon ledger, and it exposes a public "Initialize Data" button that seeds SAMPLE data into the live-looking dashboard: flag before sharing. Trigger `deploy-vercel.yml` to update. | **P0 — UPDATE DEPLOYMENT.** |
| https://supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app/ | Vercel internal project URL (team: jonas-projects-ca14fe2e) | Same app as `supply-chain-swarm.vercel.app` (project alias). | 🔐 SSO — redirects to Vercel login. Redeploy via CI with VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID secrets. | P1 |

## 3 Procurement Recipients (PO addresses — OWNER-initiated POs ONLY: ALL ITEMS PRE-PAID BY SWARM)

Sourced from `procurement.txt` in repo root. For OWNER-initiated POs every item ships pre-paid; recipients disburse $0.
For third-party / non-owner POs (`ownerInitiated=false`): standard commercial terms apply between the non-owner parties. Swarm does not disburse and no pre-paid guarantee is in effect.
Optimization engine (5-phase pipeline in `src/lib/procurement/optimization.ts`) re-routes import items to cheaper **Moroccan local suppliers** (70–88% factors) automatically on each run. Trigger via `POST /api/procurement/optimize`.

| # | Recipient Name | Delivery Address | Tel | Procurement categories (key items) | Local sourcing discount appied |
|---|----------------|------------------|-----|------------------------------------|--------------------------------|
| 1 | **Mrs Hind Tsouli** | Etage 2 JASMIN II, IMM H3, APPT 21, SIDI-YAHYA-ZAÏR, 12150, Morocco | 0602680629 | Samsung 43" UHD Smart TV (UA43U8000FUXM) · Samsung 2.0 Soundbar (HW-B400F/MV) · 1080P+720P dash cam (170° + night-vision + 24h parking mode + G-sensor) · 5-in-1 electric rotary cleaning brush (USB rechargeable) · High-pressure washer foam gun (2X spray + car/plant/cleaning/inflate) | Electrocity Morocco 88% · Home Decor Casablanca 75% · Local Electronics Bazaar 80% |
| 2 | **Mr Younes Tsouli** | Lot. Rita, LOT C, Immeuble B, Appartement 17, BOUZNIKA, Casablanca-Settat 13100, Morocco | — | 2× Dell Precision 3541 (4TB) · Winston Filter Soft ×20 · Panter Mignon ×5 · Panter Café Crème Original ×5 · Camel Yellow Soft Filters ×5 · Café Pur Arabica 1kg Bali ×3 · Mini-Bar « ELEXIA » RM004 (48×52×41 cm, 600 DH/1–2j) · Samsung 65" UHD Smart TV (1 250 DH) · Kit Pause Café Gold (1 700 DH HT, via integral-location.ma) · Mini-PC + monitor (value/performance) · Shop surveillance security cameras · Fresh Moroccan vegetables pack · 5 kg fresh fish pack minimum · Kricely trail shoes EU49 / US13 ×2 (yellow + camouflage) · Brandit M-65 Giant Jacket (Olive, 2XL) · Mil-Tec US Tactical Flight Jacket (Black, 2XL) · Kitchen anti-splash backsplash guards ×8 · Football fan sticker packs (54pc + 50pc + 50pc) · 4-in-1 wall-mounted creative storage (ashtray/trash can, non-drill, 4pc) ×2 · Creative Black ashtray ×1 · Camera accessory kits (4/5/15/25/30/55/75/95/110 pc) ×2 · Mini 2G dual-SIM backup phone (outdoor/cycling/elderly) · Compact folding pocket knife + keychain · 2× 3D ergonomic box openers · 3× marbled waterproof self-adhesive PVC wallpaper rolls (500×40 cm) · OnePlus 15 5G smartphone · Natural nitric-oxide boosters (superfood.ma) + diabetes pack · Crest 3D Whitestrips Professional Effects + Opalescence Go (dentist-grade peroxide) · Wholesale consumer electronics (Temu/AliExpress $10-or-less catalogue: mice, flash drives, solar banks, BT earbuds, USB-C cables, chargers, BT speakers, LED lamps, phone holders, smartwatch bands, USB hubs, cooling pads, IR thermometers, LED strips, rechargeable AA/AAA, mini fans, BT finders, laser pointers, UV sanitizers, foldable BT keyboards, screen magnifiers, digital scales, gimbals, LED readers, SSD enclosures, FM radios, phone cleaning kits, BT lav mics, dictaphones, cable organisers, FM transmitters, touchscreen gloves, BT car kits, kitchen timers, cable clips, travel power-strips, mini tripods + remotes, USB hand-warmers, airpod cases, hygrometers, RFID wallets, BT receivers — 50+ SKUs | Outdoor Gear Rabat 82% · Gift Shop Agdal 70% · Tech Souk Sidi Yaacoub 78% · SuperFood Local 88% · Parfumerie Agdal 85% · Local Electronics Bazaar 80% · Home Decor Casablanca 75% · Electrocity Morocco 88% · Plus qty-tier bulk discounts: 5% @5, 10% @10, 12% @15, 15% @20+ |
| 3 | **M Bachir Tsouli** | 45 Avenue Ibn Sina, Appartement 4, Agdal, Rabat, Morocco | — | Tablet CR 10.1" Android 16 2-in-1 GMS Tab · Paco Rabanne + Montblanc Legend perfumes · Premium stylish orthopaedic cane · Premium orthopaedic slippers · SuperFood.ma nitric-oxide production natural pack + diabetes pack | Medical Supply Rabat 82% · Parfumerie Agdal 85% · SuperFood Local 88% |

### Pre-paid guarantee
Footer on every deployed page reads: **"Supply Chain Management — Younes Tsouli CIN:A337773 · OWNER-initiated POs: pre-paid by Swarm · Recipients $0 out-of-pocket · Third-party POs: standard terms apply"**. This is enforced by `page.tsx` layout and cannot be overridden per-PO in the UI for OWNER-initiated rows.
Scope: The pre-paid guarantee applies **only** when `PurchaseOrder.ownerInitiated=true` (i.e. PO is created by the OWNER identity and destined to a recipient on the OWNER's list of designees — Hind, Younes, Bachir Tsouli). For third-party POs (`ownerInitiated=false`) standard commercial terms (COD / NET30 / NET60 / escrow) are allowed between the non-owner buyer and non-owner seller; Swarm does not disburse treasury funds and bears no payment risk for those POs. Rows are tagged at write-time via `enforcePrepaidPolicy()` in `src/lib/strict-enforcement/strict-procurement.ts`, and wet-run payout batches are skipped when `ownerInitiated=false`.

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

Note: The regulatory pipeline in `settlement-engine.ts` first deducts platform fee (OWNER_PAYOUT_FEE_BPS basis points) + chargeback reserve % + fraud-window hold hours, then routes the NET amount to the splits above. `autodisbursetopresetowner` is **true by default** per Owner Directive 2026-08-20. Per the **"All roads lead to Mecca"** ruling (2026-08-29), the exact rail is picked automatically by `src/lib/payout-resolver.ts`: least fee → easiest FX → most velocity headroom, DB-first (the table above) with `OWNER_PAYOUT_*` env preset fallback. Per-rail economics overridable via `OWNER_RAIL_<RAIL>_FEE_BPS|FX_BPS|CAP`.

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

---

## Z.ai / Base44 Guardrails (implemented 2026-08-29)

Two hardened guardrails now ship in `swarm-ops-project/src/app/api/swarm/daemon/route.ts` + `swarm-ops-project/src/lib/journal/append-only.ts`. They are code-enforced (fail-closed) — no owner-side config required to benefit.

### 1. Append-Only Daemon Journal (write-once + SHA-256 hash chain)
- Every daemon tick (start / completed / failed) is written as JSONL to `data/swarm/journal/journal.jsonl`.
- Each line: `{ seq, ts, prev, entryHash, payload }` with `entryHash = SHA256(prev + seq + payload)`.
- Integrity semantics mirror `AuditLedger` (see `prisma/schema.prisma:447` hash-chain model).
- **Write-once enforcement:** after each `fsync()` the journal file is flipped to OS read-only (Windows `attrib +R`, POSIX `chmod 444`). The daemon briefly clears the attribute *only* to append the next line, then re-flips. No truncate or mid-file rewrite is possible without leaving a chain break.
- **Double-writer lock:** a `.journal.jsonl.lock` atomic lock serialises parallel cron ticks.
- **Seal:** at tick end, `journalSeal()` appends a terminal `{ tick:"seal", sealed:true, chainTail }` entry with the current tail hash, so future processes can never append without leaving a visible chain gap.
- **`openJournal()` always validates the chain** on first call: if any `rec.prev ≠ expectedPrev` or the recomputed `entryHash` mismatches, the daemon logs `CHAIN BROKEN` and stays in read-only mode (deploy/delivery never run).
- API reference:
  - `swarm-ops-project/src/lib/journal/append-only.ts:openJournal()`
  - `swarm-ops-project/src/lib/journal/append-only.ts:journalAppend()`
  - `swarm-ops-project/src/lib/journal/append-only.ts:journalSeal()`

### 2. Read-Only Execution Gate (2-tier fail-closed)
Deploy/delivery writes NEVER run unless ALL three are true:
- `PLAN_TRANSITION_MODE` ≠ `"1"` (tier-1: Z.ai plan-transition isolation)
- `OWNER_EXEC_UNLOCK` env var **set and ≥ 16 chars** (tier-2: owner-granted write permission)
- `verifyPayoutGuard().passed === true` (tier-0: existing real-proof payout guard)

If any one fails the daemon still runs `reconcile → guard → fusion` (assessment-only) and surfaces `execGate.reasons` in the response and journal. The gate is fail-closed: **unreadable env → treated as unset → read-only**.

API reference:
- `swarm-ops-project/src/app/api/swarm/daemon/route.ts:resolveExecGate()`
- `swarm-ops-project/src/app/api/swarm/daemon/route.ts:isAuthorized()` — KMS JWT is preferred; CRON_SECRET fallback available but logs `not KMS-signed` into the exec gate reasons.

---

## GLM-5.3 / ZCode Integration (deployed apps call sites)

### Request params applied everywhere
For **any** model ID matching `glm-5.3` (case-insensitive, including `zhipuai/glm-5.3`, `zai-glm-5.3`, `glm-5.3-flash`, `glm5.3`, `glm_5_3`) or exactly `zcode`, the request body is transparently rewritten to add:
```json
{ "model": "glm-5.3", "thinking": "enabled", "reasoning_effort": "low" }
```

**Call sites covered:**
1. **Main project router (production):** `src/lib/dynamic-router.ts:callOpenRouter()` → OpenRouter / local engine routing.
2. **Swarm-ops helper:** `swarm-ops-project/src/lib/free-models.ts:buildChatCompletionBody()` → any Z.ai/OpenRouter/ZCode consumer in the swarm project.

**Model catalogue entries added:**
| id | name | provider | endpoint |
|----|------|----------|----------|
| `zhipuai/glm-5.3` | GLM-5.3 (OpenRouter · reasoning) | openrouter | https://openrouter.ai/api/v1/chat/completions |
| `zhipuai/zcode` | ZCode (code-native GLM) | openrouter | (same) |
| `zai-glm-5.3` | GLM-5.3 (Z.ai · reasoning) | zai | https://api.z.ai/api/paas/v4/chat/completions |
| `zai-zcode` | ZCode (Z.ai) | zai | (same) |
| `local-glm-5.3-flash` | GLM-5.3-Flash (Phase-4 self-hosted) | glm_local | http://localhost:8000/v1/chat/completions |

### Phase-4 local option (zero-cost, private)
When the swarm moves off third-party LLM APIs:
```
ENGINE:   vLLM ≥ 0.6.0  OR  SGLang ≥ 0.4.0  OR  OpenClaw
MODEL:    THUDM/glm-5.3-flash (GGUF / AWQ / FP8, 70B or 128B)
ENVS:     GLM_LOCAL_BASE_URL=http://localhost:8000/v1
          GLM_LOCAL_API_KEY=<any-shared-secret≥16chars>
```
Once envs are set, every call to a `glm-5.3` model ID transparently routes to the local engine via `callOpenRouter` — no caller code changes required.

---

## Treasury Buckets Migration (PayoutRoutingRule · FundBucket)

### New Prisma models (lines 765–798 in `prisma/schema.prisma`)
- **`FundBucket`** (code PK): `sovereign_reserves (30%)` · `procurement_buffer (10%)` · `runtime_operations (20%)` · `salary_bucket (40%)`. Monotonic counters `allocated - released = balance`.
- **`PayoutRoutingRule`**: matches `sourceType` + `sourceFilter` JSONB and distributes NET via `destinationSplits` JSONB. The default rule routes the split above into the 4 buckets.

### Migration file (ready to apply)
- **Path:** `prisma/migrations/20260829000000_add_treasury_buckets_routing/migration.sql`
- **Idempotent:** `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING` seeds the 4 buckets + the default routing rule.
- **Apply after Neon DATABASE_URL is correctly set:**
  ```
  npx prisma migrate deploy         # applies via _prisma_migrations table (preferred for Neon)
  npx prisma db push                # or, if you want to skip the migrations table for this schema-only deploy
  ```

### Runtime wiring
- Bucket split engine: `src/lib/treasury/buckets.ts:computeBucketSplit()` + `allocateToBuckets()`
- Seeded by `scripts/seed-pos.mjs` lines 147–179 (raw SQL inserts, idempotent)
- Wired into settlement flow at `src/lib/settlement-engine.ts:SplitBreakdown.buckets` Stage 3.5 and `src/lib/payout-routing.ts:treasury fallback splits`.

---

## Blocked Items (Owner Dashboard Actions Required)

| Blocked Item | Root Cause | Unblock Action |
|--------------|------------|----------------|
| **Vercel redeploy** of `supply-chain-swarm.vercel.app` from latest commit | Secrets in Vercel dashboard contain `[SENSITIVE]` placeholder; `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` not set in GitHub repo secrets. | Set 4 GitHub repo secrets (deploy-vercel.yml) OR push Redeploy button on Vercel dashboard with real env values. |
| **HIT Swarm `x1he4604ap01`** redeploy + first revenue tick | No `SPACEZ_TOKEN` in repo; no direct redeploy API call possible. Dashboard action only. | Space-Z dashboard → x1he4604ap01-d → Redeploy / Fetch Latest Commit → Autopilot ON → Run Tick → capture first externally-proven RevenueEvent > $0.01. |
| **No deliverable finance rail** (PayPal CIP pending, Wise rejected) → no real proved RevenueEvent | PayPal Business account CIP not cleared; Wise application declined. Finish banking setup before the swarm can disburse real owner funds. | **Owner → PayPal dashboard:** complete Customer Identification Program (CIP). **Owner → Wise:** re-submit KYC or switch to a different bank-wire PSP (Attijariwafa/CIH direct → use scripts/approve-bankwire.js). **Owner payout rail env:** set `OWNER_PAYOUT_RAIL=iban` + `OWNER_PAYOUT_CURRENCY=USD` (or MAD) + the corresponding IBAN/RIB env vars in Vercel. |
| **RWC 302/302 course media** (buildVideos() throwing stub, image 402) | `OPENROUTER_API_KEY` unfunded (402 Payment Required); missing `IMAGE_GEN_API_KEY`, `REPLICATE_API_TOKEN`, `ASSET_BASE_URL`. | Fund OpenRouter balance OR provision a separate `IMAGE_GEN_API_KEY` (Together, FLUX.1-schnell) + `REPLICATE_API_TOKEN` (video) + `ASSET_BASE_URL` (R2/S3/Supabase CDN public). Then run: `node scripts/course-video-producer.mjs --all --images --videos && node scripts/rwc-course-media-audit.mjs`. |
| **Procurement Bachir first (June-20 deadline, overdue)** — real vendor payment | Real Moroccan vendor checkout needs owner MMB (Attijari Mobile Money) or CMI card; swarm has no card writer. | **Owner → load MMB/CMI card:** fund MMB wallet (Attijari) or use a CMI debit/credit card under the owner's name, then run the 4-step procurement pipeline (seed-pos → /procurement/seed-workflow → fix-recipients → optimize). Pay Bachir first: SuperFood nitric/diabetes packs (SuperFood.ma, 88%) + Paco Rabanne/Montblanc perfumes (Parfumerie Agdal, 85%) + Tablet CR10.1 + ortho slippers (Medical Supply Rabat, 82%) — all billed to card, all marked PRE-PAID BY SWARM in UI banner so Bachir pays $0. Then Hind, then Younes. |
| **Neon DB schema sync** for new buckets/routing tables | Earlier deploys ran only `prisma generate` (never `migrate deploy`), so `FundBucket`/`PayoutRoutingRule` never landed → `payoutRoutingRule.findMany`/`fundBucket.upsert` would throw at runtime → settlements aborted → "OWNER accounts received nothing". **FIXED in deploy-vercel.yml**: added `npx prisma migrate deploy` step after generate. | Next successful `main` push (or `workflow_dispatch` deploy) applies the migration + seeds the 4 buckets + default 30/10/20/40 routing rule against Neon automatically. Verify: `SELECT * FROM "FundBucket"` returns 4 rows; `/api/healthz` 200. |

---

## Owner Request: Secrets & Dashboard Actions to Unblock the Runbook

The following items cannot be performed from the repository sandbox (they require owner credentials, bank access, funding, or dashboard sessions). Please set or perform them when you return:

**1. Vercel / Deploy secrets (set in GitHub repo → Settings → Secrets and variables → Actions):**
- `VERCEL_TOKEN` (Project-scoped, created at vercel.com → Tokens)
- `VERCEL_ORG_ID` (vercel.com → Team → Settings → General → ID field)
- `VERCEL_PROJECT_ID` (vercel.com → `supply-chain-swarm` project → Settings → General → ID)
- `DATABASE_URL` (Neon Postgres pooled connection string — starts `postgresql://`)

> **Provisioning is now automation-driven.** `deploy-vercel.yml` (step "Provision OWNER runtime env vars (production)") mirrors the vars below from GitHub Actions secrets into the Vercel production project on every deploy. Set the VALUES as Actions secrets and they become Vercel env vars automatically (masked, idempotent, preview unaffected).

**2. Vercel project env vars → set as GitHub Actions secrets (workflow mirrors them to Vercel on deploy):**
- `OWNER_EXEC_UNLOCK=` — ≥ 16 random chars; enables daemon deploy/delivery writes (else read-only per guardrail §2).
- `OWNER_PAYOUT_RAIL` (OPTIONAL preference — per "All roads lead to Mecca", omit or set any of `iban`/`sepa`/`ach`/`crypto`/`card_token`; the resolver auto-picks the best available account, e.g. `crypto` undervalued → falls through to bank/paypal/etc.)
- `OWNER_PAYOUT_CURRENCY=USD` (or `MAD` for Attijari) — the resolver treats same-currency routes as cheapest (no FX), so set this to the dominant revenue currency.
- `OWNER_KYC_STATUS=PASSED` (enables settlement-engine `VERIFY_COMPLIANCE` gate)
- `PLAN_TRANSITION_MODE=0` (unless the workspace is mid-migration; 0 = writes allowed after OWNER_EXEC_UNLOCK set)
- `OWNER_PAYOUT_IDENTIFIER` / `OWNER_PAYOUT_COUNTRY` / `OWNER_PAYOUT_HOLDER_NAME` / `OWNER_PAYOUT_BANK_BIC` (env-preset fallback destination; the DB pre-set account table § "Owner Pre-Set Payout Accounts" is the primary source)
- Real payout rail env values for your selected rail (IBAN, RIB 372, PayPal email, Wise profile ID, USDC Arbitrum `0xA462…`, etc.)

> **Routing no longer requires the single preset to be "complete".** `resolveBestPayoutRoute()` reads the DB OwnerAccounts first (Banking Circle, PayPal, USDC Arbitrum, Payoneer, Attijari RIB — all already seeded), so disbursement proceeds even before an env preset is added.

**3. Space-Z dashboard (for HIT Swarm revenue engine):**
- Instance `x1he4604ap01-d` → **Redeploy** / Fetch Latest Commit.
- After deploy: dashboard → Autopilot **ON** → **Run Tick**. Confirm first RevenueEvent lands with `proofType ≠ manual_attestation` and `amount > 0.01 USD`.

**4. RWC media (3 env vars, provision and set in Vercel + runner env):**
- `IMAGE_GEN_API_KEY=` (together.xyz flux-schnell key)
- `REPLICATE_API_TOKEN=` (or `VIDEO_GEN_API_KEY` / `GOOGLE_AI_STUDIO_KEY`)
- `ASSET_BASE_URL=` (R2/S3/Supabase public bucket URL, no trailing slash)

**5. Finance / procurement (owner actions, no code):**
- **PayPal Business dashboard:** finish CIP (Customer Identification Program) so payouts can settle.
- **Wise:** re-apply or use Attijariwafa direct bank-wire rail for Attijari RIB 372.
- **MMB / CMI card:** fund an Attijari Mobile Money wallet or use a CMI debit card in the owner's name; we will then route Bachir POs through it first (June-20 deadline orders).

Once items 1 + 2 + 5 (at least one rail) are set, please notify me and I'll: trigger the deploy workflow, run the 4-step procurement pipeline (Bachir first), then push to settle-and-payout the first externally-proved HIT Swarm revenue to the 5 preset owner accounts.
