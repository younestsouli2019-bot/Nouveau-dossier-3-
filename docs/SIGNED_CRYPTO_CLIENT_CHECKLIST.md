# Signed crypto-API client checklist (hand-rolled, no SDK)

Pattern validated against Binance -1022 (Signature is not valid) root causes.
Applies to any HMAC-signed exchange API (Binance, Bybit, OKX, Kucoin variants).

1. **Signature over the exact payload bytes** — HMAC-SHA256 over the raw,
   already-encoded query/body string. No re-encoding after signing.
2. **Signature appended LAST** — after all other params, on the exact string
   that was signed.
3. **POST form endpoints: signature in the BODY**, not the URL query — the
   server matches the HMAC against the received form bytes.
4. **GET: send the pre-signed string untouched** — construct the URL from raw
   bytes (httpx.URL(raw_query=...) / fetch with a fully-formed string URL);
   never let an HTTP library re-normalize a signed query.
5. **X-MBX-APIKEY (or rail equivalent) header on every signed call.**
6. **Server-time timestamp** — prefer fetching the exchange clock over local
   time.time().
7. **recvWindow >= 10000** for cloud egress (dynamic IPs, variable latency).
8. **Encode consistently** — URLSearchParams/quote_plus (form style) for POST;
   strict parameter order preserved on both sides of the HMAC.
9. **IP whitelist reality on serverless** — exchange keys restricted to a
   static IP break on dynamic cloud egress (Vercel/Render); either restrict
   the key to the platform's egress range, use a fixed-IP proxy, or keep keys
   unrestricted-but-read-only.
10. **Verify with a cheap read call** (GET /api/v3/account) before any write.

Project rail status: Bitget via ccxt (SDK handles signing — no exposure).
binance-rail.mjs hand-rolls: GET path was correct; POST path fixed 2026-10-27
(signature moved into the signed body per rule 3). Binance remains geo-blocked
(451) from the sandbox and GitHub runners — live verification of the rail
requires the Paris-deployed API or another allowed egress plus credentials.
