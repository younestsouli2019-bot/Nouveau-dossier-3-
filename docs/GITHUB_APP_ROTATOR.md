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

## Provisioning the rotator App (for `crypto-address-rotation.yml`)

`.github/workflows/crypto-address-rotation.yml` reads `CENTRAL_ROTATOR_APP_ID` and
`CENTRAL_ROTATOR_PRIVATE_KEY`. While they are absent the workflow runs **read-only**
(a `::warning::` + `can_execute=false`), so no address is ever rotated. To close it:

```powershell
# Outside Trae (Admin PowerShell): gh must be authenticated there.
pwsh -File scripts/provision-rotator-app.ps1
```

The script is fail-closed and does three things, in order:

1. writes both secrets **piped on stdin** (`gh secret set NAME` with no `--body`),
   so the PEM never enters shell history or the process argument table;
2. mints a 1h App installation token — the only proof that the App ID, the PEM and
   the repo installation actually agree;
3. reads `GET /repos/{repo}/actions/secrets/public-key` with that token, proving the
   App carries **Secrets: read**. The PEM is staged in `%TEMP%` (UTF-8, no BOM) and
   deleted in a `finally` block — it never touches the working tree.

**Required App permissions:** Contents *read/write*, Workflows *read/write*,
**Secrets *read/write***, Actions *read*, Metadata *read*.

The script cannot prove **Secrets: write** without mutating a secret, so it ends by
printing the one command that does:

```
gh workflow run crypto-address-rotation.yml --repo <owner/name> -f dry_run=false
```

Success = the `Execute rotation` step runs instead of `can_execute=false`.

**Reminder:** a `workflow_dispatch` only resolves from the **default branch**, so this
workflow must be merged to `main` before the command above can find it.

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
