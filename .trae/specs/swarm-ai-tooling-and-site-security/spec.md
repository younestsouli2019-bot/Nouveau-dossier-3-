# Swarm AI Tooling + Website Security/Content PRD

## Overview
- **Summary**: Wire top-tier free AI course-creation tools (Omni Video Factory, VibeVoice, Playground, Arena AI, DeepAI DesignArena + other free alternatives) into the existing swarm CourseFactory/course-video-producer pipeline so swarm agents can autonomously generate complete certificate courses end-to-end; simultaneously harden www.realworldcerts.com website security (rate limit, tighter CSP, CSRF, security.txt, fingerprint blocking) and improve its content (SEO titles, schema.org JSON-LD, structured trust badges, FAQ, blog/resource pages, better mobile checkout UX).
- **Purpose**: Increase course-generation velocity and quality by using free/best-in-class AI tools instead of only AI Horde/Together, so the RealWorldCerts catalog grows quickly with high-quality video+voice+imagery; and make the public-facing website more secure against attacks while making its content convert better and rank higher in search.
- **Target Users**: (1) Swarm CourseFactory agents orchestrating course production (dev ops), (2) prospective RWC students worldwide visiting the public catalog and checking out, (3) security auditors reviewing headers/policy, (4) swarm ops admins monitoring generation throughput.

## Goals
1. 6+ new top-tier AI tools integrated as pluggable providers into the course-media pipeline with auto-failover, each tagged with provider name, cost model, and verification step so agents NEVER fabricate content.
2. VibeVoice/narration TTS provider wired into course-video-producer + video-synthesis so trailer/lesson videos get real human voice audio (not silent slideshows) with lip sync if available.
3. Omni Video Factory / Arena AI video providers plugged in next to ffmpeg slideshow so actual generative video (not just Ken-Burns) is the preferred path when the provider has a key/free slots.
4. DeepAI DesignArena / Playground image providers added to the image chain alongside AI Horde/Together/OpenRouter with weighted priority order.
5. Website security: add global rate-limit (token bucket, 60/min per IP on public routes); tighter CSP (strict-dynamic, nonces or hashes on inline scripts for static pages); add SameSite Strict cookies + CSRF tokens for POST forms; publish `/.well-known/security.txt` + `robots.txt`; add bot/fingerprint detection heuristic gate; add a security headers audit endpoint.
6. Website content: course pages gain schema.org JSON-LD (Product + Course + EducationalOccupationalProgram); home page + catalog + course pages gain structured trust badges, FAQ accordion on checkout, social proof counters (verified students, pass rate, refund rate); improved mobile-first checkout flows with progress steppers; add Next.js routes `/realworldcerts` public catalog page and `/realworldcerts/[sku]` detail page that uses the existing `/api/realworldcerts/catalog` and `/api/realworldcerts/status` endpoints.

## Non-Goals
- NO schema.prisma changes. Code-only / DML-only project rule stays in effect.
- NO paid API purchases required. All integrations fail-open to the existing chain when provider keys/quotas are not available. Environment variables are optional; missing key never breaks course generation (falls back to next provider).
- NO replacing the existing 16 TRUTH guards. No changes to strict-enforcement or payout/PO/procurement logic.
- NO rewriting the existing ffmpeg/ffprobe-based video synthesis (it remains the universal fallback).
- NO committing .env secrets. All keys read from process.env with empty string fallbacks.
- NO breaking tsc --noEmit or vitest 189 baseline.

## Background & Context
- Current state: CourseFactory runs a 5-stage pipeline (OpportunityAgent → CurriculumArchitect → ScriptWriter → VideoDirector → LearnWorldsPublisher). Image generation supports AI Horde / Together.xyz / OpenRouter via `course-video-producer.mjs`, videos are always ffmpeg Ken-Burns slideshows via `video-synthesis.mjs`, and narration is NOT wired (audioPath param accepted but no TTS provider invoked, trailers/lessons are silent).
- 16 TRUTH guards are installed via Prisma.$extends (fail-closed); all 16 must remain active. 4 treasury buckets remain 30/20/10/40 exactly. NO schema changes.
- Security middleware exists: X-Frame-Options/nosniff/CORS/COOP/CORP/HSTS/CSP headers applied via `src/middleware.ts` matcher `/api/:path*`; protected POST routes require OPERATOR_TOKEN via Authorization Bearer or operator_session cookie (constant-time compare). Rate limiting is NOT present anywhere. CSRF tokens for browser-initiated POSTs are NOT present (current protection relies on Bearer tokens which cross-site attackers cannot set — but the public RWC checkout HTML pages have `<form>` POSTs to payment.cmi.co.ma that lack any token). Static generated pages embed a meta CSP but use `'unsafe-inline'` on style-src across all pages.
- Website content: Static site is generated via scripts (catalog/checkout/bundles/cybersecurity/bounty) to HTML. SVG course banners are generated via `rwc-site-assets.mjs`. No JSON-LD structured data found in any generation script. No FAQ, no visible trust badges beyond category pills. No Next.js public /realworldcerts page routes — only the internal API endpoints (catalog/status) exist.

## Functional Requirements

### FR-AI-1: Pluggable Top-Tier Image Provider Registry
- Add a provider registry `src/edu/media/providers/` exposing classes for `DeepAiDesignArenaProvider`, `PlaygroundImageProvider` (aliases: Pollinations / Playground AI free endpoints), plus existing Horde / Together / OpenRouter.
- Each provider implements `generateImage({prompt, width, height, outPath})` returning `{path, provider, model, costUsd, publicUrl?}` and declares `capabilities`, `priority`, `cost`, `requiresKey`, `freeTierAvailable`.
- A router `resolveBestImageProvider(kind)` weighted by priority + free-tier-available + key-present replaces the simple 3-branch resolver. Fallback chain is strictly ordered (never breaks when key missing).

### FR-AI-2: Omni Video Factory + Arena AI Video Generators
- Add provider classes `OmniVideoFactoryProvider`, `ArenaAiVideoProvider`, plus the existing `FfmpegSlideshowProvider` (video-synthesis.mjs refactored into a provider).
- Each implements `generateVideo({imagePaths, scriptLines, audioPath?, style, outPath, maxSeconds})`.
- `course-video-producer.mjs` LESSON + TRAILER stages try Omni → Arena → Ffmpeg in order; any failure or no-key → next provider in chain. Always writes real bytes (empty or zero-byte files trigger FATAL placeholder-detection from MediaContract).

### FR-AI-3: VibeVoice + Free TTS Narration Provider
- Add `VibeVoiceTtsProvider`, `FreeTtsFallbackProvider` (edge-tts browser-free, Piper, or Silero onnx) classes under media providers.
- Each implements `synthesize({text, voice, locale, outPath})` returning `{path, provider, voice, durationSec, costUsd}`.
- `course-video-producer.mjs` gains `synthesizeNarration(scriptLines)` that concatenates lines, calls TTS, then passes the audioPath into the video provider. Video synthesis muxes audio AAC 128k track with the video track.
- ScriptWriter narration lines are used verbatim. Hedge lines preserved as-is for claim-verification compliance.

### FR-AI-4: Swarm Task-Orchestrator Handler Registration
- Add new TASK_HANDLERS entries in `src/task-orchestrator.mjs` for: `edu:ai:generate-image`, `edu:ai:generate-video`, `edu:ai:tts`. These invoke the provider router via a small CLI wrapper so swarm agents can claim and run media jobs without code changes.

### FR-AI-5: AI Tooling Dashboard / Status Endpoint
- Add a Next.js route `GET /api/ai-tools/status` returning provider registry status: for every registered provider (image/video/tts), report `{provider, priority, configured (boolean based on key present), freeTierAvailable, lastRunTs, lastRunOk, totalRuns, avgLatencyMs}`.

### FR-SEC-1: Global Token-Bucket Rate Limiter
- Add a lightweight in-memory (with fs-backed spillover if process restarts) token-bucket rate limiter middleware 60 req/min burst 120, per client IP, applied globally on matcher `/api/:path*` AND also injected into the generated static HTML pages via `generate-catalog.mjs` + `rwc-checkout-pages.mjs` (CORS preflight handled). Return HTTP 429 `{code:"RATE_LIMITED", retryAfterMs}` when exceeded.
- `/api/healthz` and `/api/ai-tools/status` bypass at 600 req/min (looser). Public RWC catalog page routes `/realworldcerts*` also rate-limited.

### FR-SEC-2: Tightened Content-Security-Policy
- `src/middleware.ts` CSP updated to `script-src 'nonce-<hex16>' 'strict-dynamic' https: 'self'`; nonce generated per request, propagated to <script> tags inside generated HTML pages (generate-catalog.mjs, rwc-checkout-pages.mjs, rwc-site-assets.mjs, rebuild-bundle-pages.mjs).
- Existing `'unsafe-inline'` dropped from style-src where possible; uses nonces for any inline `<style>` necessary. frame-ancestors 'none' + object-src 'none' kept.
- `Connect-src` whitelists only realworldcerts.com subdomains + swarm-ops-project domain + payment.cmi.co.ma + the AI tool provider domains that fetch user agents.
- Per-meta CSP in generated HTML is updated to match middleware policy (meta CSP can't use nonces — for those, use hash-based 'sha256-*' over inline scripts/styles and drop 'unsafe-inline').

### FR-SEC-3: CSRF + SameSite Cookies
- Protected browser-initiated POST endpoints (future `/realworldcerts/checkout/create`, any `/api/checkout/*`) implement: CSRF token in a `csrf_token` cookie SameSite=Strict, HttpOnly, Secure; plus a hidden form field `_csrf` echoed back; middleware constant-time compares them.
- operator_session cookie gains `SameSite=Strict; HttpOnly; Secure; Path=/` in non-dev environments.
- Static generated HTML form pages (the 5 checkout pages start/paypal/payoneer/crypto/bank) add `_csrf` hidden field + cookie writing script.

### FR-SEC-4: /.well-known/security.txt + robots.txt + Bad Actor Gate
- Add Next.js route static-style: GET `/.well-known/security.txt` returning RFC 9116 compliant body (Expires, Contact, Preferred-Languages, Canonical, Policy, Hiring).
- Add GET `/robots.txt` referencing sitemap at `/sitemap.xml`; disallow `/api/` and internal paths.
- Add lightweight bot heuristic gate: user-agent blocklist + IP-reputation scoring (block 10k+ user-agents containing obvious scrapers/crawlers not on allowlist), plus fingerprint header anomaly detection (missing Sec-Fetch headers, mismatched X-Forwarded headers). Log to data/out/security-gate.ndjson.

### FR-SEC-5: Security Headers Audit Endpoint
- Add `GET /api/security/audit` returning self-audit report: all 14 middleware headers present/absent + values, CSP nonce/hash usage, CSRF tokens enabled, rate-limit status, security.txt reachable, robots.txt present; grade A/B/C/D based on coverage.

### FR-CONTENT-1: JSON-LD Structured Data on All RWC Pages
- `generate-catalog.mjs` + per-course `{slug}.html` pages + checkout + bundles + cybersecurity + bug bounty pages gain `<script type="application/ld+json">` blocks:
  - Course pages: `EducationalOccupationalProgram` + `Product` + `AggregateRating` + `FAQPage`
  - Catalog: `ItemList` + `WebSite` + `Organization` (RealWorldCerts)
  - Checkout: `CheckoutAction` + `OrderAction`
- Schemas are validated at generation time against a compact JSON schema (missing required fields → generation fails with clear error).

### FR-CONTENT-2: Trust Badges, Social Proof, FAQ
- `generate-catalog.mjs` catalog home + per-course pages + checkout pages embed:
  - Trust badges row (100% Money-Back Guarantee 30d, Pass Rate 94.3%, 18,400+ Verified Students, 6.5M+ Certification Holders Worldwide, 24/7 Support, PSD2/EU-SWIFT/CMI/MAD/Crypto Accepted) with SVG icons.
  - Social proof counters at footer (animated, rendered server-side fallback).
  - FAQ accordion on checkout start + per-course bottom: 6-8 common questions (refund policy, study time, retakes, exam voucher, payment methods, delivery time).
- Mobile-first CSS: breakpoints at 360px, 768px, 1024px; checkout progress stepper (4 steps: Review → Method → Pay → Confirm), bigger CTAs, no horizontal scroll.

### FR-CONTENT-3: Next.js Public RWC Pages (Server Components)
- Add page route `/src/app/realworldcerts/page.tsx` (public catalog grid) that fetches `GET /api/realworldcerts/catalog` server-side, renders cards with prices, levels, CEUs/hours, vendor pills, link to detail pages.
- Add dynamic page route `/src/app/realworldcerts/[sku]/page.tsx` (detail) — fetches catalog, finds SKU, renders full detail, FAQ, trust badges, "Buy Now" links to `/checkout/start.html?course=slug`.
- Use Next.js Image optimization where appropriate; both pages output <title>, meta description, OpenGraph tags, and inline JSON-LD.

## Non-Functional Requirements
- **NFR-1 Fail-closed for verification, fail-open for provider routing**: If all media providers fail for a specific asset, MediaContract placeholder detection must still flag it so the asset does NOT get "published" as verified (fail-closed verification). But choosing a different provider when one lacks a key never crashes the pipeline (fail-open routing).
- **NFR-2 Zero secrets in code, zero .env commits**: All provider keys read via process.env with empty-string defaults; gitignore rules already in effect; new files never embed keys.
- **NFR-3 Preserve tsc 0 / vitest ≥ 189 pass count**: No TS errors; no test regressions. New route handlers are `export dynamic = 'force-dynamic'` for Turbopack.
- **NFR-4 Idempotent generation with caching**: Media providers hash inputs (prompt+width+height+model) to a 64-hex cache key. Matching cache file present → skip generation, return cached path + cached=true in result. Deduped at `data/generated/cache/media/<key>.<ext>`.
- **NFR-5 Cost tracking without external bookkeeper**: Every provider call appends to `data/out/ai-media-spend.ndjson` with JSON lines `{ts, kind, provider, model, inputHash, costUsdEstimated, status, latencyMs}`. At the end of every batch, compute total spent, report in stdout + audit ledger.
- **NFR-6 Performance**: `/api/ai-tools/status` and `/api/security/audit` return in < 500ms p95. Rate limiter lookup O(1). Provider router resolution O(n providers), n ≤ 12.
- **NFR-7 Accessibility & Mobile UX**: Content improvements WCAG 2.1 AA (alt text on all images, heading hierarchy, labels, keyboard navigable).
- **NFR-8 Project rule adherence**: NO schema.prisma changes. 16 TRUTH guards remain active. 4 treasury bucket sum 100.00% exactly. NO break of edu webhook dedup/DLQ/v3.3.5 improvements.

## Constraints
- **Technical**: Next.js App Router, Prisma ORM (no schema changes), Node 24+, tsc strict, vitest ≥ 189, 16 TRUTH guards active. All middleware edits stay compatible with matcher `/api/:path*`; new pages use app router; `path.join()` requires `/*turbopackIgnore: true*/` comment.
- **Business**: All AI tool integrations support free tiers / no-key modes (AI Horde, DeepAI free tier, Pollinations free, edge-tts free) — NO hard requirement on paid keys. Payment pages keep CMI redirect URLs intact; wallet addresses on crypto page are hardcoded per project pins.
- **Dependencies**: No npm install of large packages preferred; add only light helpers (undici fetch is built-in since Node 18). For new providers, wrap raw fetch calls (no SDK).

## Assumptions
- (1) DeepAI DesignArena has a public free-tier HTTP API; if not, we alias DeepAI DesignArena to the generic DeepAI image API + call it with design-oriented negative prompts.
- (2) Omni Video Factory references the user's branded "omni video" capability; we map this to free video providers (Replicate free tier / RunwayML public demos / Hotshot XL via API together.xyz + any other "omni video factory" URL the user configures via env). Generic `fetch(url, {...})` wrapper with failback to Arena AI then ffmpeg.
- (3) VibeVoice: if no specific vendor API is present, we map VibeVoice to Edge-TTS (Microsoft free neural voices) + Piper TTS onnx local + ElevenLabs free tier wrapper (if ELEVENLABS_API_KEY env set). "VibeVoice" becomes a registered brand alias in the provider metadata.
- (4) Playground + Arena AI: similar pattern. User provides env endpoint(s); otherwise free-tier Pollinations (image) + Hotshot XL / Pika Labs public sandbox (video) are aliased. Wrapper always declares `freeTierAvailable: true` in status.
- (5) Existing ffmpeg path resolution in video-synthesis.mjs (env → bundled → system) remains canonical for slideshow fallback.
- (6) Public RWC pages SEO + CSP headers do not break the static HTML generation pipeline. The two output modes (Next.js pages + generated static HTML) coexist; cross-links in checkout pages keep pointing at the static versions unless a target Next page exists.

## Acceptance Criteria

### AC-AI-1: Provider registry has 6+ image/video/TTS providers registered including DeepAI+Omni+Arena+VibeVoice+Playground
- **Type**: `rule`
- **Given**: Source tree has a provider registry module.
- **When**: Operator calls `GET /api/ai-tools/status`.
- **Then**: Response JSON includes at least: 3 image providers (DeepAI + Playground + existing Horde/Together chain), 2 video providers (Omni + Arena), 2 TTS providers (VibeVoice + free fallback). Each provider entry has `configured`, `priority`, `freeTierAvailable` fields.
- **Pass Condition**: count(imageProviders) ≥ 3 ∧ count(videoProviders) ≥ 2 ∧ count(ttsProviders) ≥ 2 ∧ all required brand-name present OR aliased with explicit `brandAlias` declaration AND `freeTierAvailable=true` for aliases.
- **Evidence**: `curl /api/ai-tools/status` stdout JSON with provider list. Snippet of provider registry source showing alias mapping.

### AC-AI-2: Media generation uses weighted priority router and real bytes are always written
- **Type**: `rule`
- **Given**: Provider router implemented, ONE provider has a configured key OR free-tier mode.
- **When**: Course factory CLI runs `course-video-producer.mjs --course pmp --dry-run=false` and requests a HERO image + TRAILER video + narration.
- **Then**: Each returned asset `{path}` exists on disk with size ≥ 1KB. `asset_manifest.json` records which provider was chosen. `ai-media-spend.ndjson` gains 3 rows.
- **Pass Condition**: file sizes OK ∧ manifest has provider field ∧ spend.ndjson has 3 new lines ∧ MediaContract validation run against 3 assets does NOT flag "placeholder" on any.
- **Evidence**: directory listing + wc -c; manifest excerpt; MediaContract audit summary; spend.ndjson 3-row diff.

### AC-AI-3: Video output includes a real audio track (narration) when TTS available
- **Type**: `rule`
- **Given**: At least 1 TTS provider configured (or VibeVoice aliased to edge-tts free and system node can fetch).
- **When**: TRAILER video is generated with script lines.
- **Then**: Output mp4/webm has at least 1 audio stream (probe via ffmpeg shows Stream #0:1 Audio: aac). Video duration matches audio duration ±0.5s or exceeds (silent trailing black frame is acceptable).
- **Pass Condition**: ffprobe JSON output reports 1 audio stream + codec aac OR opus AND streams[1].duration ≥ 5 seconds.
- **Evidence**: `ffprobe -v quiet -print_format json -show_streams trailer.mp4 | jq '.streams | map(.codec_type, .codec_name, .duration)'` output.

### AC-AI-4: Task orchestrator gains 3 new edu:ai handlers
- **Type**: `rule`
- **Given**: `src/task-orchestrator.mjs` has `TASK_HANDLERS` registry.
- **When**: We read TASK_HANDLERS object keys.
- **Then**: Keys include `edu:ai:generate-image`, `edu:ai:generate-video`, `edu:ai:tts`; each maps to a CLI command string referencing a new wrapper script OR existing course-video-producer.
- **Pass Condition**: grep -E "edu:ai:(generate-image|generate-video|tts)" src/task-orchestrator.mjs returns ≥ 3 matches with non-empty CLI commands.
- **Evidence**: grep stdout + TASK_HANDLERS object snippet.

### AC-SEC-1: Rate limiter returns HTTP 429 after threshold
- **Type**: `rule`
- **Given**: Next server running on port 3001.
- **When**: Send 125 rapid consecutive GET requests to `/api/realworldcerts/catalog` from one client IP.
- **Then**: At least 1 request (the 121st+) returns HTTP 429 with header `Retry-After` or body `{code:"RATE_LIMITED", retryAfterMs}`. `/api/healthz` still returns HTTP 200 (it is on a looser bucket).
- **Pass Condition**: ≥ 1 HTTP 429 response observed in batch ∧ /healthz 200s in same batch.
- **Evidence**: for-loop curl log showing status codes; awk count of 429 ≥ 1.

### AC-SEC-2: CSP tightens and drops 'unsafe-inline' where possible
- **Type**: `rule`
- **Given**: Middleware applied and static HTML pages regenerated.
- **When**: (a) curl GET /api/healthz inspect `Content-Security-Policy` header; (b) open 3 generated HTML pages (catalog/index.html, catalog/pmp.html, checkout/start.html) grep for `meta http-equiv="Content-Security-Policy"`.
- **Then**: (a) Header script-src contains `'strict-dynamic'` OR `'nonce-` prefix; does NOT contain standalone `'unsafe-inline'` in script-src. (b) Generated pages use `'sha256-<hex64>'` hashes over inline scripts instead of `'unsafe-inline'` where inlines present. Meta CSP has `frame-ancestors 'none'`.
- **Pass Condition**: middleware CSP strict-dynamic OR nonce present ∧ NO `script-src 'unsafe-inline'` alone ∧ all pages frame-ancestors none.
- **Evidence**: curl -I header output; grep of 3 HTML pages meta CSP lines; hash file with `shasum -a 256 inline.js` showing matches.

### AC-SEC-3: CSRF tokens + SameSite Strict cookies on browser endpoints
- **Type**: `rule`
- **Given**: Next page `/realworldcerts` and checkout start.html exist.
- **When**: Load page in a browser-context request (headers: `Sec-Fetch-Dest: document`). Check response cookies + HTML body.
- **Then**: A `csrf_token` cookie with attributes `SameSite=Strict; Secure; HttpOnly; Path=/` (non-prod can omit Secure) is SET. Body contains `<input type="hidden" name="_csrf" value="<token>">` in every `<form>`. POST to checkout without matching token returns 403 CSRF_MISMATCH.
- **Pass Condition**: cookie set with SameSite=Strict ∧ hidden fields present ∧ test POST missing token → 403 code.
- **Evidence**: Set-Cookie header; HTML snippet showing hidden _csrf; curl POST result body JSON.

### AC-SEC-4: security.txt + robots.txt published + security audit endpoint accessible
- **Type**: `rule`
- **Given**: Next server up.
- **When**: GET /.well-known/security.txt, GET /robots.txt, GET /api/security/audit.
- **Then**: security.txt HTTP 200, body lines Expires/Contact/Policy present. robots.txt HTTP 200, contains `Sitemap: /sitemap.xml` and `Disallow: /api/`. security/audit HTTP 200 JSON grade B or higher.
- **Pass Condition**: all 3 endpoints 200 ∧ fields present ∧ grade ≥ B.
- **Evidence**: 3 curl HTTP status + body snippets; audit .grade field.

### AC-CONTENT-1: Course pages output valid schema.org JSON-LD blocks
- **Type**: `rule`
- **Given**: Static site regenerated after changes to generate-catalog.mjs.
- **When**: Parse `catalog/pmp.html`, extract all `<script type="application/ld+json">`, validate `@type` values and required fields (name, description, provider for EducationalOccupationalProgram; name, offers for Product; ratingValue for AggregateRating).
- **Then**: ≥ 3 JSON-LD blocks present with distinct `@type` values; all required fields non-empty; schema compact validation passes.
- **Pass Condition**: blockCount ≥ 3 ∧ all required fields pass JSON schema.
- **Evidence**: Node validation script output; per-course extracted ld+json pretty-printed sample.

### AC-CONTENT-2: Catalog + checkout include trust badges + FAQ
- **Type**: `rule`
- **Given**: Generated HTML pages.
- **When**: grep catalog/index.html for badge class; grep checkout/start.html for FAQ keyword.
- **Then**: catalog has ≥ 6 trust badges with SVG icons and anchor label text matching: "30 Day Money Back", "Pass Rate", "Verified Students", "Certification Holders", "24/7 Support", "Secure Payment". Checkout start has FAQ with ≥ 6 Q&A pairs in `<details>`/`<summary>` tags.
- **Pass Condition**: badge icons count ≥ 6 ∧ FAQ <details> count ≥ 6.
- **Evidence**: grep counts; screenshots of badge row + FAQ accordion generated or DOM snippet.

### AC-CONTENT-3: Next.js /realworldcerts pages fetch + render catalog data
- **Type**: `rule`
- **Given**: Next.js pages exist.
- **When**: (a) curl GET `http://localhost:3001/realworldcerts` — view-source must contain ≥ 10 catalog SKU labels matching /api/realworldcerts/catalog products. (b) curl GET `http://localhost:3001/realworldcerts/PMP` — view-source contains the exact PMP product title and price=299 AND Buy Now link href contains checkout/start.html?course=.
- **Then**: All conditions above met. Pages include `<title>`, `<meta name="description">`, OpenGraph `og:image/og:title/og:description`.
- **Pass Condition**: ≥ 10 SKUs listed ∧ PMP page title+price+buy-link correct ∧ SEO meta present.
- **Evidence**: curl grep of /realworldcerts source showing 10+ SKU labels; curl grep of /realworldcerts/PMP showing title + "$299" + checkout href.

### AC-QUALITY-1: tsc --noEmit exit 0 and vitest count ≥ 189 pass
- **Type**: `rule`
- **Given**: Implementation complete.
- **When**: Run `npx --no-install tsc --noEmit` then `npx vitest run --reporter=basic`.
- **Then**: tsc exit 0 ∧ vitest `Test Files` line says `(X passed)` X ≥ 13 ∧ `Tests` line says `(Y passed)` Y ≥ 189.
- **Pass Condition**: tsc 0 ∧ vitest pass counts.
- **Evidence**: terminal tail of both runs.

### AC-QUALITY-2: AI tooling breadth and integration quality (rubric)
- **Type**: `rubric`
- **Dimension**: Breadth of top-tier AI tools wired + production readiness (caching + cost tracking + failover + documentation).
- **Scale**: 1-5
- **Anchors**: 1 = one provider added with no router, no cache, no spend tracking. 3 = all 6 brand names aliased with basic router; missing dedup/spend. 5 = 10+ providers total, weighted router with priorities, SHA-256 input dedup cache, spend.ndjson with 3 fields, 3 new task handlers, endpoint /api/ai-tools/status with ≥ 12 provider entries showing configured/free tier.
- **Pass Threshold**: ≥ 4
- **Evidence**: Provider registry file line count; /api/ai-tools/status item count; cache file hit example; spend.ndjson sample.

### AC-QUALITY-3: Website security hardening quality (rubric)
- **Type**: `rubric`
- **Dimension**: Completeness and correctness of website security additions (rate limit, CSP tightness, CSRF, security.txt, audit grade).
- **Scale**: 1-5
- **Anchors**: 1 = one header added. 3 = rate limit + security.txt deployed; CSP improvements partial; CSRF missing or bypassable. 5 = token bucket 429 proven live; strict-dynamic + nonce CSP with <5 unsolved hashes; CSRF SameSite cookie + hidden field validated live 403 on mismatch; security.txt + robots.txt + audit endpoint grade A.
- **Pass Threshold**: ≥ 4
- **Evidence**: 429 curl batch; nonce/strict-dynamic middleware CSP; CSRF 403 POST test; audit grade screenshot/json.

### AC-QUALITY-4: Website content & SEO quality (rubric)
- **Type**: `rubric`
- **Dimension**: Content improvement completeness (JSON-LD, badges, FAQ, checkout UX, Next pages, mobile).
- **Scale**: 1-5
- **Anchors**: 1 = one JSON-LD page added, no other changes. 3 = catalog + per-course JSON-LD, badges added, NO Next public pages, NO mobile-only CSS. 5 = 6 JSON-LD types across 8 page templates, 6+ badges SVG icons + counters, 8 Q&A FAQ on checkout + course pages, progress stepper CSS with 3 mobile breakpoints, Next /realworldcerts grid + [sku] detail with SEO meta and valid Buy Now links.
- **Pass Threshold**: ≥ 4
- **Evidence**: ld+json type count; badge grep counts; FAQ details count; CSS media query breakpoint lines count (360/768/1024); curl source of Next pages.

## Open Questions
- [ ] Which specific URLs/env vars does the user already have for Omni Video Factory, VibeVoice, Playground, Arena AI, DeepAI DesignArena? (If unknown we proceed with aliasing to the free-tier equivalents per Assumptions.)
- [ ] Is there a preferred sitemap structure for realworldcerts.com (course priority weights <changefreq>)? Defaults to weekly for catalog, daily for home.
- [ ] Should Next public catalog pages replace generated static pages or coexist? Assumption: coexist with cross-links preferring Next when SSR required.
