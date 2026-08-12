# Vault GitHub OIDC Setup

This directory contains scripts and documentation for configuring HashiCorp Vault to trust GitHub's OIDC provider for secure secret injection without long-lived PATs.

## Prerequisites

### Required Tools
- `vault` CLI (v1.12+)
- `jq` (JSON processor)
- `curl` (HTTP client)
- Bash 4+

### Required Access
- Administrator access to a Vault cluster (v1.12+)
- GitHub repository with Actions enabled

## Quick Start

### 1. Authenticate to Vault

```bash
# Option A: UserPass auth
vault login -method=userpass username=admin

# Option B: Token auth
export VAULT_TOKEN=hvs.xxxxx

# Option C: LDAP auth
vault login -method=ldap username=user
```

### 2. Run the Setup Script

```bash
chmod +x setup-jwt-auth.sh

./setup-jwt-auth.sh --repo younestsouli2019-bot/Nouveau-dossier-3-
```

### 3. Verify Configuration (Dry-Run)

```bash
./setup-jwt-auth.sh --repo owner/repo --dry-run
```

### 4. Customize Vault URL (If Needed)

```bash
./setup-jwt-auth.sh \
  --repo owner/repo \
  --vault-url https://vault.example.com:8200
```

## What Gets Configured

The script automates the following Vault setup:

### 1. JWT Auth Method
```bash
vault auth enable -path=github-actions jwt
```

### 2. GitHub OIDC Provider
```bash
vault write auth/github-actions/config \
    oidc_discovery_url="https://token.actions.githubusercontent.com" \
    bound_issuer="https://token.actions.githubusercontent.com"
```

### 3. Secret Injection Policy
```
path "secret/data/swarm/providers/*" {
  capabilities = ["create", "update", "read"]
}

path "secret/metadata/swarm/providers/*" {
  capabilities = ["list", "read"]
}

path "secret/data/swarm/audit/*" {
  capabilities = ["create", "update", "read", "list"]
}

path "sys/leases/renew" {
  capabilities = ["update"]
}
```

### 4. JWT Role for GitHub Actions
```bash
vault write auth/github-actions/role/github-secrets-sync \
    bound_audiences="https://vault.swarm-ledger.internal" \
    bound_claims='{"repository":"owner/repo"}' \
    user_claim="actor" \
    role_type="jwt" \
    policies="secrets-sync-policy" \
    ttl="1h" \
    max_ttl="8h"
```

## GitHub Repository Secrets

After Vault is configured, add these secrets to your GitHub repository:

**Settings → Secrets and variables → Actions**

```
VAULT_CLUSTER_URL          = https://vault.swarm-ledger.internal:8200
PAYPAL_LIVE_CLIENT_ID      = (from PayPal)
PAYPAL_LIVE_SECRET         = (from PayPal)
PAYONEER_OAUTH_TOKEN       = (from Payoneer)
PAYONEER_PAYEE_ID          = (from Payoneer)
CRYPTO_PRIVATE_KEYS        = (encrypted private keys)
SWIFT_GATEWAY_CREDS        = (bank wire credentials)
```

## Verify Configuration

```bash
# List JWT auth method
vault auth list

# Check OIDC configuration
vault read auth/github-actions/config

# List policies
vault policy list

# View the JWT role
vault read auth/github-actions/role/github-secrets-sync

# Verify secret paths
vault kv list secret/data/swarm/providers
```

## Testing the Workflow

1. Push to `main` branch or trigger manually:
   ```
   Actions → Swarm Vault Sync → Run workflow
   ```

2. Check workflow logs for success:
   ```
   Actions → Swarm Vault Sync → Latest run
   ```

3. Verify secrets injected to Vault:
   ```bash
   vault kv list secret/data/swarm/providers
   vault kv get secret/data/swarm/providers/paypal
   ```

## Token Rotation

The GitHub Actions workflow automatically:
- Requests a new GitHub OIDC token on each run
- Authenticates to Vault with JWT
- Gets a Vault token (TTL: 1 hour, max: 8 hours)
- Injects secrets into ephemeral in-memory storage
- **Never stores tokens or secrets on disk**

Scheduled rotation: Every 8 hours via cron schedule

## Troubleshooting

### "Not authenticated to Vault"
```bash
vault login -method=userpass username=admin
```

### "Vault at ... may not be reachable"
Check Vault URL and network connectivity:
```bash
curl -k https://vault.example.com:8200/v1/sys/health
```

### "Repository not specified"
Provide repository in `OWNER/REPO` format:
```bash
./setup-jwt-auth.sh --repo younestsouli2019-bot/Nouveau-dossier-3-
```

### "JWT auth already enabled"
This is normal. The script will skip if already configured.

### Verify Vault OIDC Configuration
```bash
vault read -format=json auth/github-actions/config | jq '.data'
```

## Security Best Practices

✅ **DO:**
- Use short-lived tokens (1 hour TTL)
- Rotate credentials regularly
- Store secrets as GitHub repository secrets
- Use HTTPS for Vault connections
- Enable audit logging in Vault
- Review audit logs periodically
- Use temporary tokens for testing

❌ **DON'T:**
- Commit secrets to git
- Use long-lived PATs
- Store secrets in code
- Use unencrypted HTTP
- Share VAULT_TOKEN
- Log sensitive values

## Audit Trail

Check Vault audit logs:
```bash
vault audit list
vault audit enable file file_path=/var/log/vault-audit.log
```

View recent authentications:
```bash
vault list auth/github-actions/login
```

## Documentation

- [Vault JWT Auth](https://www.vaultproject.io/docs/auth/jwt)
- [GitHub OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [Vault KV Secrets Engine](https://www.vaultproject.io/docs/secrets/kv/kv-v2)

## Support

For issues, check:
1. Script logs (verbose output)
2. Vault audit logs
3. GitHub Actions workflow logs
4. Network connectivity to Vault
5. Vault authentication credentials
