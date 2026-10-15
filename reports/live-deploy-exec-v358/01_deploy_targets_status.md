# 01 — Deploy Targets Inventory (9 targets T1→T9)

| Target Deploy | Mécanisme existant | Prérequis Env/Secrets | Status (Honest Fail-Closed) |
|---|---|---|---|
| T1 GitHub https-origin main | scripts/push-outside-sandbox-v358.ps1 Admin HORS 6 étapes | Git Credential Manager Core + PAT base64 + Admin PS elevation HORS Trae | 🔒 RUNBOOK-GENERATED ADMIN HORS TRAE (USER double-clic required — NG6 push disabled sandbox Trae) |
| T2 GitLab mirror | scripts/mirrors/sync-mirrors.cmd lines L23→L31 git push --mirror | GITLAB_MIRROR_REPO + GITLAB_PAT scope write_repository + read | ❌ SKIP (GITLAB_MIRROR_REPO + GITLAB_PAT envs absents 0/2 — set Machine level permanents: [Environment]::SetEnvironmentVariable) |
| T3 Codeberg mirror | scripts/mirrors/sync-mirrors.cmd L33→L41 git push --mirror SSH | CODEBERG_MIRROR_REPO ssh://git@codeberg.org/... + SSH keypair in ssh-agent running | ❌ SKIP (CODEBERG_MIRROR_REPO env absent + ssh-agent Codeberg deploy key not loaded 0/1 prerequisites) |
| T4 Local file backup mirror bare repo | scripts/mirrors/sync-mirrors.cmd L43→L50 git push --mirror local path | LOCAL_MIRROR_DIR env e.g. D:\swarm-doomsday-mirror\repo.git must exist as bare git clone | ❌ SKIP (LOCAL_MIRROR_DIR env absent 0/1 — set first and git init --bare at target path) |
| T5 zspace swarm autonomy dirs + logs | mkdir -p data/swarm_autonomy/logs + data/out + .base44-cache | None — pure local directories probe presence | ✅ OK (mkdir -p executed 5 dirs verified exists NG1 readonly pure filesystem) |
| T6 Base44 SDK RevenueEvents cache | @base44/sdk 0.8.13 Mission/Earning/PayoutRequest entities pull | BASE44_APP_ID + BASE44_SERVICE_TOKEN env vars with scope revenue:read | ❌ SKIP (BASE44_APP_ID + BASE44_SERVICE_TOKEN env vars 0/2 missing — seeded 2 fallback dummy entries NG1 readonly NO SDK net call) |
| T7 Doomsday Vault local AES-256-GCM build | scripts/mirrors/backup-doomsday-vault.ps1 (tar+openssl enc pbkdf2 1M iter) | DOOMSDAY_ARCHIVE_PASSPHRASE env OR .keys/doomsday-passphrase.txt file + openssl on PATH (Git/usr/bin) | ❌ SKIP (DOOMSDAY_ARCHIVE_PASSPHRASE env absent + .keys/doomsday-passphrase.txt file NOT found 0/2) |
| T8 Secure-Cloud Supabase Storage upload | scripts/mirrors/secure-cloud-upload.cmd 2-step: Presigned POST then Supabase Object PUT | SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET (optional SECURE_CLOUD_PRESIGNED_URL) | ❌ SKIP (3/3 mandatory SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + MIRROR_SUPABASE_BUCKET envs ABSENTS 0/3) |
| T9 Vercel Web Frontend Deploy | .github/workflows/deploy-vercel.yml vercel pull --prod + deploy --prebuilt | VERCEL_TOKEN + VERCEL_TEAM_ID scope production | ❌ SCOPE-EXCLUDED (user explicit multi-select NOT Vercel choice AskUserChoices 2026-10-05 confirm — hors scope aujourd'hui) |

NG2 pre-check non-gitkeep files: received=0 · exports=0

SkipReasonsCountDeploy=6