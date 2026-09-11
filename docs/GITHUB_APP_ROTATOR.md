# GitHub App Rotator — short-lived tokens, no PATs

Replaces every long-lived credential that touches this repo with 1-hour GitHub App
installation tokens. Context: the 2026-09-08 credential audit found a committed
`.credentials` file (3 Base44 service tokens + a GitHub PAT) exposed for months.
PATs cannot be auto-rotated (MFA) — App installation tokens can, and expire by design.

## What this replaces
| Old (leak-prone) | New (this) |
|---|---|
| `SELF_HEALING_TOKEN` PAT for workflow-file repairs | App token (needs `workflows:write`) |
| Agent OAuth token blocked from workflow pushes | App token mints with full perms per grant |
| Manual secret rotation in repo Settings | `scripts/rotate-repo-secrets.mjs` |
| Leaked `GH_PAT` | revoke it; nothing long-lived takes its place |

## Owner setup (one-time, ~5 min)
1. GitHub → Settings → Developer settings → **GitHub Apps → New GitHub App**
   - Name: `swarm-rotator` (or any)
   - Repository permissions: **Contents: Read/Write, Workflows: Read/Write, Secrets: Read/Write, Actions: Read, Metadata: Read**
   - Where can this app be installed: **Only on this account** (or the org for the mirror)
2. Generate a **private key** (.pem) → keep it in a vault, give it to the Superagent secrets store.
3. **Install** the app on `younestsouli2019-bot/Nouveau-dossier-3-` (and the org mirror if the org permits GitHub Apps — that bypasses the OAuth-App restriction that has blocked the mirror cleanup).
4. Hand the Superagent three values: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`.

## Tooling (already on main)
- `scripts/mint-app-token.mjs` — RS256 JWT → installation token (1h). `--env` mode for CI.
- `scripts/rotate-repo-secrets.mjs` — libsodium sealed-box handshake (`public-key` → encrypt → PUT), Shopify pattern. Rotates Actions secrets with the 1h token, e.g. the long-failing `APP_WEBHOOK_URL`/`APP_WEBHOOK_SECRET`.

## In CI / self-healing loop
The hourly self-healing workflow can use `actions/create-github-app-token@v1` with
`CENTRAL_ROTATOR_APP_ID` + `CENTRAL_ROTATOR_PRIVATE_KEY` secrets — same pattern the
blueprint already uses, minus the PAT.

## ⚠️ What NOT to do with this
Do **not** point a bidirectional SHA-sync (repo-sync/github-sync) at this repo and the
`www-realworldcerts-com` mirror. They share zero ancestry (verified 2026-09-08): SHA
validation would always report "out of sync" and a force-push would overwrite one
universe with the other. The App is for credentials and secrets only; the mirror
relationship stays curated-docs-only until the privatize decision lands.
