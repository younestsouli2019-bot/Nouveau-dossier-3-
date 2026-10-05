# 07 — Fail-Closed Skip-Reasons Coverage Audit (≥14, all ≥40 chars)

Total Skip cells count = **14**

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
| 9 | ❌ SKIP wrapper exec (LASTEXITCODE=99) — 0 real rails exécutés: EXIT=99 DB_AUTH_FAIL (gates open G1 pass Neon creds refused — rotate DATABASE_URL pooled) | 152 |
| 10 | ❌ SKIP (Attijari PSD2 OAuth2 + G2 DATABASE_URL Neon — 4/4 creds missing 0 rails réel aujourd'hui) | 97 |
| 11 | ❌ SKIP (Same 4 creds Attijari PSD2 + DATABASE_URL missing — SKIP cause R1 parent credential set absent) | 103 |
| 12 | ❌ SKIP (BC SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC routing 5/5 missing total) | 86 |
| 13 | ❌ SKIP (Same 5 Banking Circle SDK secrets as R3 — shared 5/5 missing) | 69 |
| 14 | ❌ SKIP (Payoneer client/id/secret/token 3/3 + PayPal CIP case ouvert MA-147672146951995880 total 4/4 missing) | 109 |

Coverage statistic: 
- Total count 14 ≥ 14? ✅ YES
- 100% strings length ≥40? ✅ 100% pass