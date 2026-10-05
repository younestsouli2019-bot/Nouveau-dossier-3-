# 07 — Fail-Closed Skip-Reasons Coverage Audit (≥14, all ≥40 chars)

Total Skip cells count = **18**

| Index | Skip Reason (40+ chars minimum) | String Length |
|---:|---|---:|
| 1 | ❌ SKIP (GITLAB_MIRROR_REPO + GITLAB_PAT envs absents 0/2 — set Machine level permanents: [Environment]::SetEnvironmentVariable) | 127 |
| 2 | ❌ SKIP (CODEBERG_MIRROR_REPO env absent + ssh-agent Codeberg deploy key not loaded 0/1 prerequisites) | 101 |
| 3 | ❌ SKIP (LOCAL_MIRROR_DIR env absent 0/1 — set first and git init --bare at target path) | 87 |
| 4 | ❌ SKIP (BASE44_APP_ID + BASE44_SERVICE_TOKEN env vars 0/2 missing — seeded 2 fallback dummy entries NG1 readonly NO SDK net call) | 129 |
| 5 | ❌ SKIP (DOOMSDAY_ARCHIVE_PASSPHRASE env absent + .keys/doomsday-passphrase.txt file NOT found 0/2) | 98 |
| 6 | ❌ SKIP (3/3 mandatory SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET envs ABSENTS 0/3) | 105 |
| 7 | ❌ SKIP (DOOMSDAY_ARCHIVE_PASSPHRASE env absent + .keys/doomsday-passphrase.txt file NOT found 0/2) | 98 |
| 8 | ❌ SKIP (BASE44_APP_ID + BASE44_SERVICE_TOKEN env vars 0/2 missing Base44 RevenueEvents cache) | 93 |
| 9 | 🔴 FAIL 0/36 keys filled .swarm/owner-hands-free.config.ps1 §A 36 ordered placeholders ALL empty → threshold 8 min FAIL_CLOSED NOOP 0 rails exécutés | 148 |
| 10 | 🔴 FAIL len=0 empty. Expected Neon PROD pooled URL format postgres://user:pass@ep-XXXX-pooled-XXXX.us-east-2.aws.neon.tech/main?sslmode=require options=project=XXXX len≈122 attendue | 181 |
| 11 | 🔴 FAIL KEY len=0 SECRET len=0. Expected len≥32 chacun HMAC dual scope Spot Withdraw + Wallet Status + IP whitelist 45.155.0.0/16 configured in Binance API Management Console | 174 |
| 12 | 🔴 FAIL len=0 empty. Expected 43+ chars haute entropie ex: `openssl rand -base64 40 | tr -d '\\n'` produces 54 alphanumeric base64 URL safe | 139 |
| 13 | ❌ SKIP wrapper exec (LASTEXITCODE=5) — 0 real rails exécutés: EXIT=5 FAIL_CLOSED_NOOP ✅ (0<8 secrets gates, 0 rails, 0 payout, 0 Binance call) | 142 |
| 14 | ❌ SKIP (Attijari PSD2 OAuth2 + G2 DATABASE_URL Neon — 4/4 creds missing 0 rails réel aujourd'hui) | 97 |
| 15 | ❌ SKIP (Same 4 creds Attijari PSD2 + DATABASE_URL missing — SKIP cause R1 parent credential set absent) | 103 |
| 16 | ❌ SKIP (BC SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC routing 5/5 missing total) | 86 |
| 17 | ❌ SKIP (Same 5 Banking Circle SDK secrets as R3 — shared 5/5 missing) | 69 |
| 18 | ❌ SKIP (Payoneer client/id/secret/token 3/3 + PayPal CIP case ouvert MA-147672146951995880 total 4/4 missing) | 109 |

Coverage statistic: 
- Total count 18 ≥ 14? ✅ YES
- 100% strings length ≥40? ✅ 100% pass