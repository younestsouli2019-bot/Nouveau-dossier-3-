#!/usr/bin/env bash
# apply.sh — one-shot apply for the payout-rail bundle.
# Copies src/payouts/, .github/workflows/payout-rail.yml, and creates the data/
# directory layout into the target ChariBaaS repo.
#
# Usage:  bash apply.sh /path/to/Nouveau-dossier-3-
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <repo_root>"
  exit 1
fi

REPO="$1"
SRC="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$REPO" ]; then
  echo "ERROR: repo root does not exist: $REPO"
  exit 1
fi

echo "[apply] target repo: $REPO"
echo "[apply] bundle src:  $SRC"

# 1. Copy src/payouts/ (the rail modules)
mkdir -p "$REPO/src/payouts"
cp -v "$SRC/src/payouts/"*.mjs "$REPO/src/payouts/"

# 2. Copy .github/workflows/payout-rail.yml
mkdir -p "$REPO/.github/workflows"
cp -v "$SRC/.github/workflows/payout-rail.yml" "$REPO/.github/workflows/"

# 3. Create data directories (audit log + KYC db will be created at runtime)
mkdir -p "$REPO/data/payouts" "$REPO/data/kyc"

# 4. Initialize an empty KYC db if none exists
if [ ! -f "$REPO/data/kyc/kyc-db.json" ]; then
  echo '{"recipients":{}}' > "$REPO/data/kyc/kyc-db.json"
  echo "[apply] initialized data/kyc/kyc-db.json"
fi

# 5. .gitignore additions — make sure secrets and the live store are never committed
GITIGNORE="$REPO/.gitignore"
touch "$GITIGNORE"
for pattern in \
  ".env" \
  ".env.local" \
  ".env.*.local" \
  "data/payouts/audit.jsonl" \
  "data/kyc/kyc-db.json" \
  "secrets/" \
  "*.pem" \
  "*.key"; do
  if ! grep -qxF "$pattern" "$GITIGNORE" 2>/dev/null; then
    echo "$pattern" >> "$GITIGNORE"
    echo "[apply] .gitignore += $pattern"
  fi
done

# 6. Local verification — does the CLI run?
echo ""
echo "[verify] running: node src/payouts/cli.mjs kyc list (in $REPO)"
( cd "$REPO" && KYC_DB_PATH=data/kyc/kyc-db.json node src/payouts/cli.mjs kyc list ) || {
  echo "ERROR: CLI smoke test failed"
  exit 1
}

echo ""
echo "DONE. Next steps:"
echo "  1. cd $REPO"
echo "  2. Add the required GitHub Actions secrets (see README.md → Secret checklist):"
echo "       PAYOUT_MODE_LIVE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT"
echo "       PAYONEER_PARTNER_ID, PAYONEER_API_KEY, PAYONEER_ENVIRONMENT"
echo "  3. Create the 'payout-live' environment in repo settings with required reviewers."
echo "  4. Run the audit (if not already done):"
echo "       node /home/z/my-project/scripts/audit_receivables.mjs"
echo "  5. KYC-verify each recipient once:"
echo "       node src/payouts/cli.mjs kyc verify younestsouli2019@gmail.com --operator younes --evidence 'drivers-license.jpg' --evidence 'proof-of-address.pdf' --rail paypal"
echo "  6. Dry-run a single Class A item:"
echo "       node src/payouts/cli.mjs pay <item_id> --rail paypal"
echo "  7. Live payout (requires PAYOUT_MODE=live in env + --mode live on CLI):"
echo "       PAYOUT_MODE=live node src/payouts/cli.mjs pay <item_id> --rail paypal --mode live"
