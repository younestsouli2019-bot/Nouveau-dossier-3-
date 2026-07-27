#!/usr/bin/env bash
# setup-gh-secrets.sh — push all Wise/owner env keys into the repo's GitHub Actions secrets.
#
# Usage:
#   ./setup-gh-secrets.sh                  # interactive (prompts for values)
#   ./setup-gh-secrets.sh --from .env      # read from .env
#   ./setup-gh-secrets.sh --dry-run        # print gh commands without running
#
# Requires: gh CLI authenticated to the target repo.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-younestsouli2019-bot/Nouveau-dossier-3-}"
SECRETS=(
  WISE_API_KEY
  WISE_PROFILE_ID
  WISE_ENVIRONMENT
  WISE_SOURCE_CURRENCY
  OWNER_BENEFICIARY_NAME
  OWNER_BANK_RIB
  OWNER_BANK_NAME
  OWNER_BANK_COUNTRY
  OWNER_BANK_CURRENCY
  OWNER_SWIFT
  OWNER_SWIFT_BIC
  OWNER_ACCOUNT_NUMBER
  OWNER_IBAN
  OWNER_SORT_CODE
  OWNER_ROUTING_NUMBER
  OWNER_PAYPAL_EMAIL
  PAYPAL_CLIENT_ID
  PAYPAL_CLIENT_SECRET
  PAYPAL_API_BASE_URL
  PLAID_CLIENT_ID
  PLAID_SECRET
  PLAID_ACCESS_TOKEN
  PLAID_ENV
  OWNER_NOTIFICATION_WEBHOOK
  WHATSAPP_API_URL
  BANK_WIRE_PROVIDER
  BANK_WIRE_ENABLE
  LIVE_ONLY_PAYOUTS
  ALLOW_BALANCE_ONLY_PAYOUT
  LIVE_REVENUE_LOOKBACK_DAYS
  REQUIRE_LIVE_BATCH_PROVENANCE
  PAYOUT_THRESHOLD
  PAYOUT_METHOD
  SWARM_LIVE
  OWNER_WISE_RECIPIENT_ID
  CIRCUIT_BREAKER_THRESHOLD
  SUPERVISOR_MAX_FAILURES
  SUPERVISOR_STALE_HOURS
  PROCUREMENT_LIVE_ONLY
  PROCUREMENT_SEND_ENABLED
  PROCUREMENT_DRY_RUN
)

mode="interactive"
env_file=""

for arg in "$@"; do
  case "$arg" in
    --from) env_file="${2:-}"; shift 2 ;;
    --from=*) env_file="${arg#*=}"; shift ;;
    --dry-run) mode="dry-run"; shift ;;
    --help|-h)
      sed -n '2,11p' "$0"; exit 0 ;;
    *) shift ;;
  esac
done

if [ -n "$env_file" ] && [ -f "$env_file" ]; then
  mode="from-env"
fi

echo "=== GITHUB SECRETS BOOTSTRAP ==="
echo "Target repo: $REPO"
echo "Mode:        $mode"
echo "Secrets:     ${#SECRETS[@]} total"
echo ""

set_secret() {
  local key="$1"
  local val="$2"
  if [ "$mode" = "dry-run" ]; then
    echo "DRY-RUN  gh secret set $key --repo \"$REPO\" --body '<hidden>'"
    return 0
  fi
  if [ -z "$val" ]; then
    echo "SKIP     $key (empty)"
    return 0
  fi
  echo "$val" | gh secret set "$key" --repo "$REPO" --body -
  echo "SET      $key"
}

if [ "$mode" = "from-env" ]; then
  for key in "${SECRETS[@]}"; do
    val=$(grep -E "^${key}=" "$env_file" | head -1 | cut -d= -f2- | tr -d '\r' || true)
    if [ -n "$val" ] && [ "$val" != '""' ] && [ "$val" != "''" ]; then
      set_secret "$key" "$val"
    else
      echo "SKIP     $key (not set in $env_file)"
    fi
  done
else
  for key in "${SECRETS[@]}"; do
    read -r -s -p "  $key = " val
    echo
    set_secret "$key" "$val"
  done
fi

echo ""
echo "=== DONE ==="
echo "Verify with:  gh secret list --repo \"$REPO\""
