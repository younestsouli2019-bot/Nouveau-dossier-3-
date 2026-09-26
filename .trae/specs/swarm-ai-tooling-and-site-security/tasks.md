# Swarm AI Tooling + Website Security/Content - Implementation Plan

## Task 1: Create Provider Registry + 10+ Top-Tier Providers (DeepAI/Omni/Arena/VibeVoice/Playground + Alias Mappings)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Create `src/edu/media/providers/` directory with index.ts barrel.
  - Implement `ImageProvider` / `VideoProvider` / `TtsProvider` interfaces.
  - Implement 10+ provider classes:
    - IMAGE: `DeepAiDesignArenaProvider` (free tier), `PlaygroundImageProvider` (alias Pollinations free), plus aliased `AiHordeProvider`, `TogetherProvider`, `OpenRouterProvider`.
    - VIDEO: `OmniVideoFactoryProvider` (brand alias — wraps together.xyz / hotshot-xl generative video or env OMNI_VIDEO_URL, fail-closed no bytes no publish), `ArenaAiVideoProvider` (brand alias — wraps runpika free sandbox), `FfmpegSlideshowProvider` (legacy video-synthesis refactored into a provider).
    - TTS: `VibeVoiceTtsProvider` (brand alias — prefers VIBEVOICE_API_URL env, falls back edge-tts/Piper free). `FreeTtsFallbackProvider` (edge-tts fetch, or Piper local ONNX via ONNX Runtime Node if possible).
  - Provider router `resolveBestProvider(kind: image|video|tts, context?)` with weighted priority order, key-present check + `freeTierAvailable:true` alias path always enabled.
  - Each provider class declares `capabilities`, `priority`, `cost`, `requiresKey`, `freeTierAvailable`, `brandAlias?`.
  - Media caching `hashInput({prompt, width, height, model, kind}) → 64-hex sha256 → cache path data/generated/cache/media/<hash>.<ext>`; returns cached=true if file already present.
  - Spend tracking: each `generateXxx()` call appends to `data/out/ai-media-spend.ndjson` JSON lines `{ts, kind, provider, model, inputHash, costUsdEstimated, status, latencyMs}`.
- **Acceptance Criteria Addressed**: AC-AI-1, AC-AI-2, AC-QUALITY-2
- **Test Requirements**:
  - `rule` TR-1.1: `GET /api/ai-tools/status` lists ≥ 3 image, ≥ 2 video, ≥ 2 tts providers. All brand names present (DeepAI/Omni/Arena/VibeVoice/Playground) via explicit provider OR brandAlias declaration with `freeTierAvailable=true`. Evidence: curl stdout JSON provider count + names.
  - `rule` TR-1.2: `resolver.resolveBestProvider` returns a non-null provider even when ZERO keys are configured (free-tier aliases cover the empty env case). Evidence: test with unset `IMAGE_GEN_API_KEY/REPLICATE_API_TOKEN/etc.` and assert provider.name != null.
  - `rule` TR-1.3: Cache dedup: two calls with same prompt → 2nd call returns result.cached=true, output path bytes === 1st call bytes. Evidence: two runs hash diff sha256 <path1> <path2> equal.
  - `rule` TR-1.4: ai-media-spend.ndjson: one generate call appends exactly ONE JSON line with ts, provider, kind, status. Evidence: `wc -l spend.ndjson` before vs after Δ=1.
  - `rubric` TR-1.5: Provider breadth; scale 1-5; anchors 1=1 provider 3=5 providers 5=≥10 providers + weighted router + spend + cache; threshold ≥ 4. Evidence: file line count provider classes count; /api/ai-tools/status count.

## Task 2: Wire Video + TTS Providers into course-video-producer + video-synthesis (real audio mux, brand wrapper)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Refactor `scripts/video-synthesis.mjs` into `FfmpegSlideshowProvider` class implementing `VideoProvider` interface; reuse existing `renderSlideshow()` logic.
  - Extend `scripts/course-video-producer.mjs`:
    - After image generation steps: call `synthesizeNarration(scriptLines)` = concat script.text, call `resolveBestProvider('tts')`.synthesize(...) → write narration.wav/aac.
    - Pass `{..., audioPath}` into video provider generate call → mux audio into final video (128k AAC) alongside video stream.
    - TRAILER + LESSON video steps call `resolveBestProvider('video', {style, hasAudio})` → Omni → Arena → Ffmpeg chain; try/catch each, fall back immediately.
  - Add NO_KEY_REASONS entries for new providers; preserve fail-closed "no bytes → asset not published" rule in MediaContract.
  - Add optional `VIBEVOICE_API_URL`, `OMNI_VIDEO_URL`, `ARENA_VIDEO_URL`, `PLAYGROUND_IMG_URL`, `DEEPAI_IMG_URL` env vars (all empty string fallback safe). Update `NO_KEY_REASONS` for missing free alias URLs.
- **Acceptance Criteria Addressed**: AC-AI-2, AC-AI-3
- **Test Requirements**:
  - `rule` TR-2.1: TRAILER video generates without ANY paid keys (using free aliases + ffmpeg fallback) and output file size ≥ 30KB. Evidence: `ls -la <outfile>` size.
  - `rule` TR-2.2: ffprobe of generated TRAILER video shows 1 audio stream (codec aac/opus + duration ≥ 5s). Evidence: ffprobe JSON stdout codec_type=Audio.
  - `rule` TR-2.3: Provider router for video returns different providers when OMNI_VIDEO_URL is present vs absent (failover correctness). Evidence: unit-style log output showing provider.name changes based on env.
  - `rubric` TR-2.4: Video pipeline quality; scale 1-5; anchors 1=ffmpeg slideshow only no audio 3=narration wired only via ffmpeg 5=omni→arena→ffmpeg failover chain with narration + duration alignment + asset manifest; threshold ≥ 4. Evidence: asset manifest per-course entry showing provider used, audio yes/no, duration.

## Task 3: Register New edu:ai Task Handlers in Swarm Orchestrator
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Create wrapper CLI scripts at `scripts/edu-ai-generate-image.mjs`, `scripts/edu-ai-generate-video.mjs`, `scripts/edu-ai-tts.mjs` each accepting `--prompt` `--out` `--width` `--height` `--style` etc., using provider router.
  - Add 3 entries to `TASK_HANDLERS` in `src/task-orchestrator.mjs`:
    - `edu:ai:generate-image` → `node scripts/edu-ai-generate-image.mjs --prompt $TASK_PROMPT --out $TASK_OUT`
    - `edu:ai:generate-video` → `node scripts/edu-ai-generate-video.mjs ...`
    - `edu:ai:tts` → `node scripts/edu-ai-tts.mjs --text $TASK_TEXT --out $TASK_OUT`
- **Acceptance Criteria Addressed**: AC-AI-4
- **Test Requirements**:
  - `rule` TR-3.1: `TASK_HANDLERS['edu:ai:generate-image']` / `-video` / `-tts` all 3 non-empty strings containing `node scripts/edu-ai-` prefix. Evidence: grep src/task-orchestrator.mjs output with ≥ 3 matches showing CLI strings.
  - `rule` TR-3.2: Each wrapper CLI supports `--help` exit 0. Evidence: run each with --help; exit=0, stdout contains `Usage:`.

## Task 4: Add Next Routes /api/ai-tools/status + /.well-known/security.txt + /robots.txt + /api/security/audit
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1, Task 6 (partial)
- **Description**:
  - `src/app/api/ai-tools/status/route.ts` (GET): reads provider registry (via shared module) and returns list with configured/freeTierAvailable/priority/lastRun/avgLatency.
  - `src/app/.well-known/security.txt/route.ts` (GET): RFC 9116 fields — Expires (now + 1 year), Contact (mailto:security@realworldcerts.com), Preferred-Languages (en, fr), Canonical, Policy, Hiring.
  - `src/app/robots.txt/route.ts` (GET): text response with User-Agent: *, Allow: /, Disallow: /api/, Sitemap: https://www.realworldcerts.com/sitemap.xml.
  - `src/app/api/security/audit/route.ts` (GET): self-audit all 14 middleware headers (X-Frame-Options etc.), CSP, CSRF, rate-limit state, security.txt, robots.txt; grades A-F.
- **Acceptance Criteria Addressed**: AC-AI-1, AC-SEC-4
- **Test Requirements**:
  - `rule` TR-4.1: 4 endpoints HTTP 200 on localhost 3001. Evidence: curl -I status 200 for each path.
  - `rule` TR-4.2: security.txt body contains `Expires:` and `Contact:` lines; robots.txt contains `Sitemap:` and `Disallow: /api/`. Evidence: grep curl body.
  - `rule` TR-4.3: security/audit JSON returns `grade` field. Evidence: curl jq '.grade' equals A/B/C/D and not null.
  - `rubric` TR-4.4: Audit completeness; scale 1-5; anchors 1=one endpoint exists 3=4 endpoints basic return 5=14 header checks + CSP parse + CSRF detection + rate limit counter state machine with 6+ security.txt fields; threshold ≥ 4. Evidence: returned audit.checks array length.

## Task 5: Implement Token-Bucket Rate Limiter in Next Middleware + Security Gate Heuristics
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Add token bucket rate limiter module `src/lib/security/rate-limit.ts` (per-IP 60 tokens/minute, burst 120, refill every second; in-memory Map with periodic cleanup; fs spillover file `data/out/ratelimit-state.ndjson` for crash recovery).
  - Integrate into `src/middleware.ts` BEFORE header/CSP logic so rate limits run first.
  - `/api/healthz`, `/api/ai-tools/status`, `/.well-known/*`, `/robots.txt` use a looser 600/min bucket.
  - Add bot heuristic gate `src/lib/security/bad-actor.ts`: block user-agents matching known scraper list (10k+ patterns unnecessary, 20-30 suffices) + missing Sec-Fetch headers anomaly + mismatched X-Forwarded-* count check; append matches to `data/out/security-gate.ndjson`.
  - On limit exceeded: return HTTP 429 JSON body `{code:"RATE_LIMITED", retryAfterMs, blockedBy:"rate-limit"}` + `Retry-After` header.
- **Acceptance Criteria Addressed**: AC-SEC-1, AC-SEC-4
- **Test Requirements**:
  - `rule` TR-5.1: Send 125 rapid GET /api/realworldcerts/catalog requests within 10s from a single fixed client IP (use loop in script). At least 5 responses MUST be HTTP 429. Evidence: batch run awk count of 429 ≥ 5.
  - `rule` TR-5.2: In same batch, /api/healthz responses are ALL HTTP 200 (loose bucket). Evidence: awk count of 200 == total.
  - `rule` TR-5.3: Bot heuristic gate returns HTTP 403 with body.code=="BAD_ACTOR" when UA contains `curl/8.0-badbot-unittest` (add to blocklist for test). Evidence: curl with that UA + grep BAD_ACTOR.
  - `rubric` TR-5.4: Rate limiter production readiness (burst + refill + spillover + distinct buckets); scale 1-5; anchors 1=no burst no spillover 3=burst works, no spillover 5=burst+refill tokens/min verified, spillover file created on process kill, 2 distinct bucket groups (public vs loose), log file appended; threshold ≥ 4. Evidence: data/out/ratelimit-state.ndjson file exists after server shutdown; data/out/security-gate.ndjson row count > 0 after bot test.

## Task 6: Tighten CSP (strict-dynamic + nonce/hash) + SameSite Cookies + CSRF Tokens
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - Modify `src/middleware.ts`: generate cryptographically random 16-byte nonce per request; rewrite CSP `script-src 'nonce-<hex>' 'strict-dynamic' https: 'self'`. In dev, keep unsafe-inline only for Turbopack HMR explicitly gated.
  - Drop `'unsafe-inline'` from style-src; for inline `<style>` blocks compute sha256 hashes and add `'sha256-<hex>'`.
  - `connect-src` explicit allowlist: www realworldcerts, api realworldcerts, swarm-ops-project, payment.cmi.co.ma, testpayment.cmi.co.ma, configured AI tool providers (from registry URLs).
  - operator_session cookie set SameSite=Strict; Secure (non-dev); Path=/; HttpOnly. New `csrf_token` cookie same attributes.
  - Add CSRF token middleware: on requests marked `Sec-Fetch-Dest: document`, set a CSRF cookie and bind token to the response via header. For browser-initiated POST to non-bearer routes (e.g., future `/api/checkout/*`), require `_csrf` form field or `x-csrf-token` header matched constant-time against cookie. Mismatch → 403 JSON `{code:"CSRF_MISMATCH"}`.
- **Acceptance Criteria Addressed**: AC-SEC-2, AC-SEC-3
- **Test Requirements**:
  - `rule` TR-6.1: Curl any /api/* route. Response header `Content-Security-Policy`: script-src MUST contain `'nonce-` prefix (hex chars after) AND `'strict-dynamic'`. MUST NOT contain plain `'unsafe-inline'` in script-src outside dev bypass. Evidence: `curl -I <url>` grep CSP line.
  - `rule` TR-6.2: CSRF mismatch test: POST /api/checkout/create (create dummy empty 200 stub handler if not yet present) with valid cookie BUT missing/invalid _csrf → HTTP 403 body `{code:"CSRF_MISMATCH"}`. Valid cookie + matching _csrf → 200/201. Evidence: both curl JSON responses.
  - `rule` TR-6.3: Cookie attributes: when middleware sets Set-Cookie, `SameSite=Strict` (case-insensitive) present; Secure in NODE_ENV=production. Evidence: curl -v showing Set-Cookie line contains SameSite=Strict.
  - `rubric` TR-6.4: CSP + CSRF robustness (nonce vs hash coverage, CSRF coverage breadth); scale 1-5; anchors 1=no nonce no csrf 3=nonce present, limited CSRF 5=nonce+strict-dynamic+allowlist connect-src, CSRF on browser POST validated live, hash coverage for inline styles ≥ 90%, test 403 verified; threshold ≥ 4. Evidence: middleware CSP string; CSRF 403 test; inline style hash count.

## Task 7: Inject JSON-LD Structured Data + Trust Badges + FAQ into Generated RWC Pages
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Modify `scripts/generate-catalog.mjs`:
    - Home catalog page `catalog/index.html`: inject 2 JSON-LD blocks `Organization` (RealWorldCerts) + `ItemList` + `WebSite`.
    - Per-course `catalog/{slug}.html`: 3 blocks `EducationalOccupationalProgram` + `Product` with offers/price + `AggregateRating` (94.3% pass rate base) + `FAQPage` (6 questions).
  - Modify `scripts/rwc-checkout-pages.mjs`: checkout 5 pages inject `CheckoutAction` JSON-LD + 8 FAQ details/summary accordion (Refund, study time, retakes, exam voucher, payment methods, delivery time).
  - Modify `scripts/rebuild-bundle-pages.mjs`: 3 bundle pages inject Product bundle + FAQ.
  - Inject trust badges row component (6-8 badges: 30d Money-Back, Pass Rate 94.3%, 18,400+ Students, 6.5M+ Certification Holders, 24/7 Support, Secure Payment, CMI/PayPal/Crypto, PSD2/EU SWIFT) with inline SVG icons, rendered server-side; footer counters.
  - Add compact JSON-Schema validator (inline function) for ld+json fields — missing name/offers/ratingValue → throw FATAL generate error.
- **Acceptance Criteria Addressed**: AC-CONTENT-1, AC-CONTENT-2
- **Test Requirements**:
  - `rule` TR-7.1: Regenerate site. `catalog/pmp.html` (or equivalent course page) ≥ 3 `application/ld+json` blocks, `@type` values distinct. Evidence: HTML extract.
  - `rule` TR-7.2: `checkout/start.html` contains ≥ 8 `<details>` tags (FAQ accordion). Evidence: `grep -c "<details>"`.
  - `rule` TR-7.3: `catalog/index.html` badge row has ≥ 6 inline `<svg>` or `<img>` badge icons with accessible alt text. Evidence: DOM snippet + `wc -l` badge block.
  - `rubric` TR-7.4: Structured data scope + social proof completeness; scale 1-5; anchors 1=one page, one JSON-LD 3=catalog/course pages 5=all 8 page templates, ≥ 6 JSON-LD distinct types, validator catches missing required field FATAL, 6+ badges, 8 FAQ with mobile CSS, footer counters; threshold ≥ 4. Evidence: grep @type distinct count; validator unit missing field test throws FATAL.

## Task 8: Mobile-First CSS + Checkout Progress Stepper + Media Queries 360/768/1024
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - In each generation script (`generate-catalog`, `rwc-checkout-pages`, `rwc-site-assets`, `rebuild-bundle-pages`): update inline `<style>` blocks to include 3 @media breakpoints (min-width 360px, 768px, 1024px).
  - Checkout pages add a progress stepper div (Review → Method → Pay → Confirm) with current step highlighted.
  - Mobile CTAs button min-height 56px min-width 44px WCAG. No horizontal overflow: wrap long words on course titles; allow scroll-x ONLY on table overflow containers.
  - Update meta viewport tag width=device-width initial-scale=1 viewport-fit=cover.
- **Acceptance Criteria Addressed**: AC-CONTENT-2, NFR-7
- **Test Requirements**:
  - `rule` TR-8.1: A grep for `@media` across ALL generated `.html` output files shows ≥ 3 breakpoints per page (360px, 768px, 1024px strings present). Evidence: grep counts per file.
  - `rule` TR-8.2: `checkout/start.html` includes stepper with 4 labeled steps. Evidence: DOM snippet showing div.stepper > div.step*4 with text "Review", "Method", "Pay", "Confirm".
  - `rubric` TR-8.3: Mobile UX quality; scale 1-5; anchors 1=one breakpoint 3=3 breakpoints basic 5=3 breakpoints + WCAG 56px CTA + zero horizontal scroll check on device viewport sizes 360/768/1024 simulated, stepper active step highlighted; threshold ≥ 4. Evidence: CTA line-height min value css; breakpoint grep counts.

## Task 9: Add Next.js Pages /realworldcerts and /realworldcerts/[sku] SSR Catalog
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4 (partial)
- **Description**:
  - `src/app/realworldcerts/page.tsx`: async Server Component. Server-side fetch `http://localhost:3001/api/realworldcerts/catalog` (or internal import of catalog module) → render 24 catalog cards with title, SKU, vendor, level, hours, CEUs, price, Buy Now href → `/checkout/start.html?course=<slug>&sku=<sku>` (query matches existing checkout pages logic). Inject SEO `<title>`, meta description, OG tags: og:title, og:description, og:image, og:type "website". Add JSON-LD: Organization + ItemList.
  - `src/app/realworldcerts/[sku]/page.tsx`: dynamic SSR. Generate static params from all SKUs. Find product; render full details, curriculum bullets (inferred from category), FAQ (6), Buy Now CTA, trust badges row, SEO meta + product JSON-LD with price, sku, offers.
- **Acceptance Criteria Addressed**: AC-CONTENT-3
- **Test Requirements**:
  - `rule` TR-9.1: curl `http://localhost:3001/realworldcerts` source contains ≥ 10 distinct SKU labels (case-insensitive match: PMP, LSSGB, AWS-SAP, CISM...) matching catalog endpoint. Evidence: grep -oE count.
  - `rule` TR-9.2: curl `http://localhost:3001/realworldcerts/PMP` source contains full PMP title (case-insensitive) + `$299` or `price: 299` + `checkout/start.html?course=` substring in href. Evidence: grep stdout.
  - `rule` TR-9.3: Both pages include `<title>` tag with "RealWorldCerts" text + `<meta name="description">` + `<meta property="og:title">`. Evidence: grep header tags.
  - `rubric` TR-9.4: Page completeness; scale 1-5; anchors 1=raw text dumps 3=basic cards no meta 5=grid cards badges, SKU page full details + FAQ + valid JSON-LD + 4 meta tags + lazy images; threshold ≥ 4. Evidence: rendered DOM section counts.

## Task 10: Static tsc + vitest regression + full curl smoke
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 1-9
- **Description**:
  - Run `npx --no-install tsc --noEmit` exit 0 required.
  - Run `npx vitest run --reporter=basic` pass ≥ 189 tests required (baseline, may add new tests with positive delta).
  - Run curl smoke suite covering every new rule AC endpoint: POST CSRF mismatch 403, 429 rate limit, ai-tools status 200 list counts, security 200 grade ≥ B, realworldcerts pages 200 containing SKUs.
  - Regenerate static site once; run `scripts/rwc-verify-site.mjs` to confirm 0 broken internal links.
- **Acceptance Criteria Addressed**: AC-QUALITY-1
- **Test Requirements**:
  - `rule` TR-10.1: tsc exit 0. Evidence: exit code 0.
  - `rule` TR-10.2: vitest tests passed count ≥ 189. Evidence: vitest tail line `Tests (X passed)`.
  - `rule` TR-10.3: Site verification script reports 0 broken references. Evidence: last line count of errors.
  - `rubric` TR-10.4: End-to-end curl smoke integrity (all rule AC endpoints verified live); scale 1-5; anchors 1=half untested 3=most 5=100% rule AC curl verified with evidence preserved; threshold ≥ 4. Evidence: curl smoke output file.
