#!/usr/bin/env bash
# apply.sh — apply the revenue engines bundle to the local Nouveau-dossier-3- clone
#
# Usage:
#   cd /path/to/Nouveau-dossier-3-        # your local clone of the repo
#   bash /home/z/my-project/download/revenue-engines-bundle/apply.sh
#
# Or from any directory, with the repo path as an argument:
#   bash /home/z/my-project/download/revenue-engines-bundle/apply.sh /path/to/Nouveau-dossier-3-

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${1:-$(pwd)}"

if [ ! -d "$REPO_DIR/.github/workflows" ]; then
  echo "ERROR: $REPO_DIR does not look like the Nouveau-dossier-3- repo (no .github/workflows/ found)"
  echo "Usage: $0 [path-to-repo]"
  exit 1
fi

echo "Applying revenue engines bundle from: $BUNDLE_DIR"
echo "Target repo:                          $REPO_DIR"
echo ""

# 1. src/revenue-engines/ (create if missing, then copy all 10 files)
mkdir -p "$REPO_DIR/src/revenue-engines"
cp -v "$BUNDLE_DIR"/src/revenue-engines/*.mjs "$REPO_DIR/src/revenue-engines/"

# 2. .github/workflows/revenue-engines.yml
cp -v "$BUNDLE_DIR/.github/workflows/revenue-engines.yml" "$REPO_DIR/.github/workflows/"

echo ""
echo "============================================================"
echo "Done. Files applied:"
echo "  - src/revenue-engines/base.mjs              (NEW, abstract base class)"
echo "  - src/revenue-engines/registry.mjs          (NEW, dynamic loader + CLI)"
echo "  - src/revenue-engines/haio-solana.mjs       (NEW, HAiO RevenueEngine adapter)"
echo "  - src/revenue-engines/haio-tx-gateway.mjs   (NEW, HAiO Transaction Gateway adapter)"
echo "  - src/revenue-engines/haio-agent-nft.mjs    (NEW, HAiO AgentNFT ERC-7857 adapter)"
echo "  - src/revenue-engines/haio-vesting.mjs      (NEW, HAiO Vesting Program adapter)"
echo "  - src/revenue-engines/aipipeline-router.mjs (NEW, ncklrs ai-pipeline LLM router)"
echo "  - src/revenue-engines/foreman-coding.mjs    (NEW, ncklrs foreman coding capacity)"
echo "  - src/revenue-engines/shipstack-pr.mjs      (NEW, ncklrs shipstack PR-as-a-service)"
echo "  - src/revenue-engines/applypilot-jobs.mjs   (NEW, ncklrs ApplyPilot job placement)"
echo "  - .github/workflows/revenue-engines.yml     (NEW, scheduled 30-min sweep)"
echo ""
echo "Next steps:"
echo "  cd $REPO_DIR"
echo "  git add -A"
echo "  git commit -m 'feat(revenue-engines): add 8 new revenue engines (HAiO x4 + ncklrs x4)'"
echo "  git push origin main"
echo ""
echo "Then verify locally:"
echo "  node ./src/revenue-engines/registry.mjs list"
echo "  node ./src/revenue-engines/registry.mjs run-all    # observe mode, no secrets needed"
echo "============================================================"
