# .github/vault-config

Vault-backed static configs synced by the `Swarm Vault Sync` workflow (main2.yml).

> Do not place secrets in this directory. Only public / metadata configs
> (policies, paths, secret-engine mount hints) belong here. Actual secret
> values are injected directly from GitHub encrypted secrets via the
> `inject-oidc` action and never touch the repository tree.

Expected layout (examples):

- `policies/*.hcl` — Sentinel/ACL policy metadata (descriptive only)
- `engines/*.yaml` — KV / Transit mount hints (descriptive only)
- `audience.json` — OIDC audience + role mapping reference, e.g.

```json
{
  "audience": "swarm-vault.younestsouli.com",
  "roles": ["admin", "owner-payout", "procurement", "etl-base44"]
}
```

## Required GitHub Actions Secrets

Set the following in **Settings → Secrets and variables → Actions**:

| Secret name             | Purpose                                                    | Required for injection? |
| ----------------------- | ---------------------------------------------------------- | ----------------------- |
| `SWARM_VAULT_API_URL`   | Base URL for the vault injection endpoint (without trailing slash). | ✅ Yes — injection step skips cleanly if missing |
| `VAULT_CLUSTER_URL`     | Vault cluster URL for `/v1/sys/health` reachability check. | ❌ Optional |
| `VAULT_OIDC_AUDIENCE`   | Override for OIDC audience. Defaults to `swarm-vault.younestsouli.com`. | ❌ Optional |

Additionally, the injection step forwards these values (if present):

- `BASE44_APP_ID`, `BASE44_SERVICE_TOKEN`
- `PLAIDBOX_KEY`, `ENVBOX_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`
- `DOOMSDAY_ARCHIVE_PASSPHRASE`
- `REPO_MAINTAINER_TOKEN`
- `VAULT_CLUSTER_URL`

## Endpoint contract

The workflow POSTs to `{SWARM_VAULT_API_URL}/api/swarm-ledger/vault` with:

```http
Authorization: Bearer <GitHub OIDC JWT>
Content-Type: application/json
Accept: application/json
```

```json
{
  "action": "inject-oidc",
  "context": { "repository": "...", "run_id": "...", "actor": "...", "sha": "...", "ref": "..." },
  "secrets": { "BASE44_APP_ID": "...", "...": "..." }
}
```

Vault should verify:

1. The OIDC JWT signature against `https://token.actions.githubusercontent.com/.well-known/openid-configuration`.
2. The JWT `aud` claim matches `swarm-vault.younestsouli.com` (or the override in `VAULT_OIDC_AUDIENCE`).
3. The JWT `iss`, `repository`, and `ref` claims match a pre-approved list.

## Workflow file location

Workflows that consume this directory:
- [main2.yml](../workflows/main2.yml) — Swarm Vault Sync (preflight + sync + inject-oidc)
