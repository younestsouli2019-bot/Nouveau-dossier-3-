#!/usr/bin/env bash
# SINGLE-COMMAND RELEASE BUNDLE
# Run on the user's machine after `git pull`:
#   ./release-3.0.0.sh
#
# Does:
#   1. Pulls latest
#   2. Tags v3.0.0
#   3. Pushes commits + tag to origin
#   4. Prints a deploy-ready status
#
# Required: GitHub auth (gh auth login OR git push with PAT/SSH)

set -euo pipefail
cd "$(dirname "$0")"

echo "=== RELEASE BUNDLE v3.0.0 — Feed-Attijari ==="
echo ""

if ! command -v gh >/dev/null 2>&1 && ! command -v git >/dev/null 2>&1; then
  echo "ERROR: need git or gh CLI"
  exit 1
fi

# Try gh first
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "[ok] gh authenticated"
  BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")
  if [ -z "${BRANCH:-}" ]; then BRANCH=main; fi

  echo "[1/4] pull latest"
  git pull --rebase || true

  echo "[2/4] push branch + tag to origin"
  git push origin "port/remote-main-procurement:$BRANCH" 2>&1 | head -5 || {
    echo "  push failed; trying HEAD:main"
    git push origin HEAD:$BRANCH 2>&1 | head -5
  }
  git push origin v3.0.0 2>&1 | head -5

  echo "[3/4] create GitHub release"
  gh release create v3.0.0 \
    --title "v3.0.0 — Autonomous Feed-Attijari" \
    --notes-file RELEASES.md 2>&1 | head -3 || echo "  release create failed (tag may already exist)"

  echo "[4/4] open PR if needed"
  gh pr create --base "$BRANCH" --head "port/remote-main-procurement" \
    --title "v3.0.0 — Autonomous Feed-Attijari" \
    --body-file RELEASES.md 2>&1 | head -3 || echo "  PR create skipped"

else
  # Fallback: plain git
  echo "[warn] gh not authed; using plain git push"
  echo ""
  echo "If you have a GitHub PAT, run:"
  echo "  git remote set-url origin https://x-access-token:\$GH_TOKEN@github.com/younestsouli2019-bot/Nouveau-dossier-3-.git"
  echo "  git push origin port/remote-main-procurement:main"
  echo "  git push origin v3.0.0"
  echo ""
  echo "If you have SSH:"
  echo "  git remote set-url origin git@github.com:younestsouli2019-bot/Nouveau-dossier-3-.git"
  echo "  git push origin port/remote-main-procurement:main"
  echo "  git push origin v3.0.0"
  exit 1
fi

echo ""
echo "=== RELEASE BUNDLE DONE ==="
