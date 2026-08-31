#!/bin/bash

################################################################################
# Vault GitHub OIDC Setup Script
# 
# This script configures HashiCorp Vault to trust GitHub's OIDC provider,
# enabling secure secret injection without long-lived PATs.
#
# Usage:
#   ./setup-jwt-auth.sh [--vault-url URL] [--repo OWNER/REPO] [--dry-run]
#
# Environment Variables:
#   VAULT_ADDR           - Vault cluster URL (default: https://localhost:8200)
#   VAULT_TOKEN          - Vault auth token (required if not logged in)
#   VAULT_NAMESPACE      - Vault namespace (default: admin)
#   GITHUB_REPO          - GitHub repository (OWNER/REPO format)
#
################################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration defaults
VAULT_ADDR="${VAULT_ADDR:-https://localhost:8200}"
VAULT_NAMESPACE="${VAULT_NAMESPACE:-admin}"
AUTH_PATH="github-actions"
ROLE_NAME="github-secrets-sync"
POLICY_NAME="secrets-sync-policy"
DRY_RUN=false
VERBOSE=false

# GitHub repository (will be extracted from context or CLI)
REPO_OWNER=""
REPO_NAME=""

################################################################################
# Utility Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $@"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $@"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $@"
}

log_error() {
    echo -e "${RED}[✗]${NC} $@"
}

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $@${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BLUE}→ $@${NC}"
    echo ""
}

################################################################################
# Validation Functions
################################################################################

check_prerequisites() {
    print_section "Checking Prerequisites"

    # Check for required CLI tools
    local required_tools=("vault" "jq" "curl")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is not installed"
            echo "Install: brew install $tool  # macOS"
            echo "Install: apt-get install $tool  # Linux"
            exit 1
        fi
        log_success "Found: $tool ($(${tool} --version 2>/dev/null | head -n1 || echo 'version unknown'))"
    done

    # Check Vault CLI configuration
    if [ -z "${VAULT_ADDR}" ]; then
        log_error "VAULT_ADDR not set"
        exit 1
    fi
    log_success "VAULT_ADDR: $VAULT_ADDR"

    # Verify Vault connectivity
    log_info "Testing Vault connectivity..."
    if ! curl -sf "${VAULT_ADDR}/v1/sys/health" > /dev/null 2>&1; then
        log_warning "Vault at ${VAULT_ADDR} may not be reachable"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        log_success "Vault is reachable"
    fi
}

validate_github_repo() {
    print_section "Validating GitHub Repository"

    if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ]; then
        log_error "Repository not specified"
        echo ""
        echo "Provide repository as: --repo OWNER/REPO"
        echo "Example: --repo younestsouli2019-bot/Nouveau-dossier-3-"
        exit 1
    fi

    # Validate repo format
    if [[ ! "$REPO_OWNER" =~ ^[a-zA-Z0-9_-]+$ ]] || [[ ! "$REPO_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        log_error "Invalid repository format: $REPO_OWNER/$REPO_NAME"
        exit 1
    fi

    log_success "Repository: $REPO_OWNER/$REPO_NAME"

    # Attempt to verify repo exists (optional, requires curl)
    if curl -sf "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}" > /dev/null 2>&1; then
        log_success "GitHub repository verified to exist"
    else
        log_warning "Could not verify GitHub repository (may require auth)"
    fi
}

check_vault_auth() {
    print_section "Checking Vault Authentication"

    if ! vault token lookup > /dev/null 2>&1; then
        log_error "Not authenticated to Vault"
        echo ""
        echo "Authenticate with one of:"
        echo "  vault login -method=userpass username=admin"
        echo "  vault login -method=ldap username=user"
        echo "  export VAULT_TOKEN=hvs.xxx"
        exit 1
    fi

    local token_info=$(vault token lookup -format=json 2>/dev/null || echo '{}')
    local ttl=$(echo "$token_info" | jq -r '.data.ttl // "unknown"')
    log_success "Authenticated to Vault (TTL: $ttl)"
}

################################################################################
# Vault Configuration Functions
################################################################################

enable_jwt_auth() {
    print_section "Step 1: Enabling JWT Auth Method"

    log_info "Enabling JWT auth at path: auth/${AUTH_PATH}"

    if vault auth list -format=json | jq -e ".\"${AUTH_PATH}/\"" > /dev/null 2>&1; then
        log_warning "JWT auth already enabled at ${AUTH_PATH}"
        return 0
    fi

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] vault auth enable -path=${AUTH_PATH} jwt"
        return 0
    fi

    vault auth enable -path="${AUTH_PATH}" jwt || {
        log_error "Failed to enable JWT auth"
        exit 1
    }

    log_success "JWT auth enabled at: auth/${AUTH_PATH}"
}

configure_oidc_provider() {
    print_section "Step 2: Configuring GitHub OIDC Provider"

    log_info "Setting GitHub as OIDC provider"
    log_info "OIDC Discovery URL: https://token.actions.githubusercontent.com"
    log_info "Bound Issuer: https://token.actions.githubusercontent.com"

    local config_cmd="vault write auth/${AUTH_PATH}/config \
        oidc_discovery_url='https://token.actions.githubusercontent.com' \
        bound_issuer='https://token.actions.githubusercontent.com'"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] $config_cmd"
        return 0
    fi

    if eval "$config_cmd" 2>/dev/null; then
        log_success "GitHub OIDC provider configured"
    else
        log_error "Failed to configure OIDC provider"
        exit 1
    fi
}

create_policy() {
    print_section "Step 3: Creating Secret Injection Policy"

    log_info "Creating policy: ${POLICY_NAME}"
    log_info "Policy permissions:"
    echo "  - secret/data/swarm/providers/* (create, update, read)"
    echo "  - secret/metadata/swarm/providers/* (list, read)"
    echo "  - secret/data/swarm/audit/* (create, update, read)"
    echo "  - sys/leases/renew (update) - for token renewal"

    local policy_content=$(cat << 'EOF'
# Swarm Ledger Secrets Sync Policy
# Allows GitHub Actions to inject provider credentials and audit logs

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

# Allow reading own token metadata
path "auth/token/lookup-self" {
  capabilities = ["read"]
}

# Deny: Direct access to other paths
path "secret/data/*" {
  capabilities = ["deny"]
}

path "auth/*" {
  capabilities = ["deny"]
}

path "sys/*" {
  capabilities = ["deny"]
}
EOF
)

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Uploading policy:"
        echo "$policy_content"
        return 0
    fi

    if echo "$policy_content" | vault policy write "${POLICY_NAME}" - 2>/dev/null; then
        log_success "Policy created: ${POLICY_NAME}"
    else
        log_error "Failed to create policy"
        exit 1
    fi
}

create_jwt_role() {
    print_section "Step 4: Creating JWT Role for GitHub Actions"

    log_info "Creating role: ${ROLE_NAME}"
    log_info "Role configuration:"
    echo "  - Audience: https://vault.swarm-ledger.internal"
    echo "  - Repository: ${REPO_OWNER}/${REPO_NAME}"
    echo "  - TTL: 1 hour"
    echo "  - Max TTL: 8 hours"
    echo "  - Policy: ${POLICY_NAME}"

    local role_cmd="vault write auth/${AUTH_PATH}/role/${ROLE_NAME} \
        bound_audiences='https://vault.swarm-ledger.internal' \
        user_claim='actor' \
        role_type='jwt' \
        policies='${POLICY_NAME}' \
        ttl='1h' \
        max_ttl='8h' \
        bound_claims='{\"repository\":\"${REPO_OWNER}/${REPO_NAME}\"'"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] $role_cmd"
        return 0
    fi

    if eval "$role_cmd" 2>/dev/null; then
        log_success "JWT role created: ${ROLE_NAME}"
    else
        log_error "Failed to create JWT role"
        exit 1
    fi
}

verify_configuration() {
    print_section "Step 5: Verifying Configuration"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Verification skipped"
        return 0
    fi

    # Verify JWT auth is enabled
    log_info "Checking JWT auth method..."
    if vault auth list -format=json | jq -e ".\"${AUTH_PATH}/\"" > /dev/null 2>&1; then
        log_success "JWT auth method verified"
    else
        log_error "JWT auth method not found"
        exit 1
    fi

    # Verify OIDC configuration
    log_info "Checking OIDC configuration..."
    local oidc_config=$(vault read -format=json "auth/${AUTH_PATH}/config" 2>/dev/null || echo '{}')
    if echo "$oidc_config" | jq -e '.data.oidc_discovery_url' > /dev/null 2>&1; then
        local discovery_url=$(echo "$oidc_config" | jq -r '.data.oidc_discovery_url')
        log_success "OIDC discovery URL: $discovery_url"
    else
        log_error "OIDC configuration not found"
        exit 1
    fi

    # Verify policy exists
    log_info "Checking policy..."
    if vault policy list | grep -q "^${POLICY_NAME}$"; then
        log_success "Policy verified: ${POLICY_NAME}"
    else
        log_error "Policy not found: ${POLICY_NAME}"
        exit 1
    fi

    # Verify role exists
    log_info "Checking JWT role..."
    if vault read -format=json "auth/${AUTH_PATH}/role/${ROLE_NAME}" > /dev/null 2>&1; then
        local role_data=$(vault read -format=json "auth/${AUTH_PATH}/role/${ROLE_NAME}")
        local bound_repo=$(echo "$role_data" | jq -r '.data.bound_claims.repository // "unknown"')
        log_success "JWT role verified: ${ROLE_NAME}"
        log_success "Bound repository: $bound_repo"
    else
        log_error "JWT role not found: ${ROLE_NAME}"
        exit 1
    fi
}

print_next_steps() {
    print_section "Next Steps"

    cat << EOF
${GREEN}✓ Vault configuration complete!${NC}

1. ${BLUE}Add GitHub Secrets${NC}
   Add these to your GitHub repository settings:
   Settings → Secrets and variables → Actions

   Required secrets:
   - VAULT_CLUSTER_URL = ${VAULT_ADDR}
   - PAYPAL_LIVE_CLIENT_ID = (from PayPal)
   - PAYPAL_LIVE_SECRET = (from PayPal)
   - PAYONEER_OAUTH_TOKEN = (from Payoneer)
   - PAYONEER_PAYEE_ID = (from Payoneer)
   - CRYPTO_PRIVATE_KEYS = (encrypted)
   - SWIFT_GATEWAY_CREDS = (bank credentials)

2. ${BLUE}Test the Workflow${NC}
   Push to main branch or manually trigger:
   
   Actions → Swarm Vault Sync → Run workflow

3. ${BLUE}Verify Secrets in Vault${NC}
   vault kv list secret/data/swarm/providers
   vault kv get secret/data/swarm/providers/paypal

4. ${BLUE}Monitor Token Rotation${NC}
   Token rotation scheduled every 8 hours via cron
   Check workflow logs: Actions → Swarm Vault Sync

${YELLOW}Security Reminders:${NC}
- Never commit secrets to git
- Rotate credentials regularly
- Review audit logs: vault audit list
- Use HTTPS for Vault connections
- Keep VAULT_TOKEN secure (use temp tokens)

${BLUE}Documentation:${NC}
- Vault OIDC: https://www.vaultproject.io/docs/auth/jwt
- GitHub OIDC: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
EOF
}

################################################################################
# CLI Argument Parsing
################################################################################

usage() {
    cat << EOF
${BLUE}Vault GitHub OIDC Setup${NC}

Usage: $0 [OPTIONS]

Options:
    --vault-url URL       Vault cluster URL (default: $VAULT_ADDR)
    --repo OWNER/REPO     GitHub repository (required)
    --namespace NS        Vault namespace (default: $VAULT_NAMESPACE)
    --dry-run            Show commands without executing
    --verbose            Enable verbose output
    -h, --help           Show this help message

Environment Variables:
    VAULT_ADDR           Override --vault-url
    VAULT_TOKEN          Vault authentication token
    VAULT_NAMESPACE      Override --namespace
    GITHUB_REPO          Override --repo

Examples:
    $0 --repo younestsouli2019-bot/Nouveau-dossier-3-
    $0 --repo owner/repo --vault-url https://vault.example.com:8200
    $0 --repo owner/repo --dry-run

EOF
    exit 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --vault-url)
                VAULT_ADDR="$2"
                shift 2
                ;;
            --repo)
                IFS='/' read -r REPO_OWNER REPO_NAME <<< "$2"
                shift 2
                ;;
            --namespace)
                VAULT_NAMESPACE="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done
}

################################################################################
# Main Execution
################################################################################

main() {
    # Parse command-line arguments
    parse_args "$@"

    # Respect GITHUB_REPO environment variable
    if [ -z "$REPO_OWNER" ] && [ -n "${GITHUB_REPO:-}" ]; then
        IFS='/' read -r REPO_OWNER REPO_NAME <<< "$GITHUB_REPO"
    fi

    print_header "Vault GitHub OIDC Setup"

    # Show configuration
    echo "Configuration:"
    echo "  Vault URL: $VAULT_ADDR"
    echo "  Namespace: $VAULT_NAMESPACE"
    echo "  Auth Path: auth/${AUTH_PATH}"
    echo "  Role: ${ROLE_NAME}"
    echo "  Policy: ${POLICY_NAME}"
    [ "$DRY_RUN" = true ] && echo "  Mode: DRY RUN (no changes will be made)"
    echo ""

    # Execute setup steps
    check_prerequisites
    validate_github_repo
    check_vault_auth
    enable_jwt_auth
    configure_oidc_provider
    create_policy
    create_jwt_role
    verify_configuration
    print_next_steps

    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY-RUN MODE: No changes were made to Vault"
        echo "Re-run without --dry-run to apply changes"
    else
        log_success "Setup completed successfully!"
    fi
}

# Run main function with all arguments
main "$@"