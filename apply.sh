#!/usr/bin/env bash
# apply.sh — apply the CI fix bundle to the local Nouveau-dossier-3- clone
#
# Usage:
#   cd /path/to/Nouveau-dossier-3-        # your local clone of the repo
#   bash /home/z/my-project/download/ci-fix-bundle/apply.sh
#
# Or from any directory, with the repo path as an argument:
#   bash /home/z/my-project/download/ci-fix-bundle/apply.sh /path/to/Nouveau-dossier-3-

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${1:-$(pwd)}"

if [ ! -d "$REPO_DIR/.github/workflows" ]; then
  echo "ERROR: $REPO_DIR does not look like the Nouveau-dossier-3- repo (no .github/workflows/ found)"
  echo "Usage: $0 [path-to-repo]"
  exit 1
fi

echo "Applying CI fix bundle from: $BUNDLE_DIR"
echo "Target repo:                 $REPO_DIR"
echo ""

# 1. package.json + package-lock.json (root)
cp -v "$BUNDLE_DIR/package.json"      "$REPO_DIR/package.json"
cp -v "$BUNDLE_DIR/package-lock.json" "$REPO_DIR/package-lock.json"

# 2. scripts/ (root) — create if missing, then copy
mkdir -p "$REPO_DIR/scripts"
cp -v "$BUNDLE_DIR/scripts/site-smoke-test.mjs"         "$REPO_DIR/scripts/"
cp -v "$BUNDLE_DIR/scripts/execute-crypto-withdraw.mjs" "$REPO_DIR/scripts/"

# 3. .github/workflows/ — patch the 2 broken ones
cp -v "$BUNDLE_DIR/.github/workflows/deploy-vercel.yml"          "$REPO_DIR/.github/workflows/"
cp -v "$BUNDLE_DIR/.github/workflows/owner-crypto-withdraw.yml"  "$REPO_DIR/.github/workflows/"

echo ""
echo "============================================================"
echo "Done. Files applied:"
echo "  - package.json (root)"
echo "  - package-lock.json (root, NEW)"
echo "  - scripts/site-smoke-test.mjs (NEW)"
echo "  - scripts/execute-crypto-withdraw.mjs (NEW)"
echo "  - .github/workflows/deploy-vercel.yml (PATCHED)"
echo "  - .github/workflows/owner-crypto-withdraw.yml (PATCHED)"
echo ""
echo "Next steps:"
echo "  cd $REPO_DIR"
echo "  git add -A"
echo "  git commit -m 'fix(ci): add missing scripts + lockfile + resilient paths'"
echo "  git push origin main"
echo "============================================================"
