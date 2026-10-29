# Code review — bbc_v3 (Binance box-code hunter), 2026-10-29

Source: user-supplied `bbc_v317.zip` (108 files, Python/async, ~45 modules + 15 test
files). Reviewed for transferable value to this project's rails.

## Verdict

Well-structured async codebase with real tests. Three patterns were worth adopting
into `scripts/binance-rail.mjs`; the rest is out of scope for our stack.

## Adopted (commit: binance-rail hardening)

1. **Server-time offset cache with 5-min TTL** (`_sync_server_time` +
   `_get_timestamp_ms` + `_time_sync_interval`): their client computes
   `offset = serverTime − localTime` once and reuses it, instead of a round trip
   per signed call. Ours now does the same, with fail-open to local clock if the
   `/api/v3/time` endpoint is unreachable. Prevents -1021/-1022 from clock skew
   and halves round trips per signed call.
2. **429/418 handling that honors `Retry-After`** (+ exponential backoff on
   transport errors, capped): their loop sleeps `retry_after + 1` and penalizes
   the rate-limit group. Ours retries up to 2 times honoring `Retry-After`,
   backoff 0.5s/1s on transport errors. Note: Binance answers sustained
   over-limit with **418 (IP ban)**, which this now also retries politely.
3. **Their -1022 post-mortem matches ours**: canonical query built once, signed
   byte-for-byte, signature appended to the SAME string, POST signed payload in
   the body with `application/x-www-form-urlencoded`, GET via raw query bytes
   (httpx.URL(query=...)) to dodge normalization. Independently confirms the fix
   applied here on 2026-10-27.

Test coverage added to `scripts/test-binance-rail.mjs`: 16 assertions now,
including offset-cache reuse and a scripted 429 → retry → success path.

## Not adopted (and why)

- **Weight-based token-bucket limiter** (`utils/rate_limiter.py`): sound design
   (1200 weight/min IP, 6000 UID, safety margin), but every production rail we
   run (Bitget) goes through ccxt, which already meters rate limits per endpoint.
   Our binance-rail is a CLI that makes single-digit calls per run; the retry
   layer is sufficient. Revisit if binance-rail ever runs as a service.
- **SQLite dedupe database** (`utils/code_database.py`): good idempotency model
   (INSERT OR IGNORE on unique code, status machine, migrations from JSON), but
   our deposit idempotency already keys on txid in the ndjson ledger + the
   CheckoutIntent entity. Adopting a second datastore would add an ops surface
   with no new guarantee.
- **Selenium redeemer, OCR extractor, detection engine, airdrop scanners,
   group monitors**: specific to claiming promo codes discovered in chat groups.
   Not applicable to our commerce rails and carries third-party-ToS risk we
   don't take on.

## Note on the claimed -1022 root causes

Their code independently confirms the checklist in `docs/SIGNED_CRYPTO_CLIENT_CHECKLIST.md`:
signature-last, POST-in-body, raw GET bytes, `X-MBX-APIKEY` header, recvWindow
10000, server-time timestamp. Three independent confirmations now (their client,
our fix, our test suite) — treat as settled.
