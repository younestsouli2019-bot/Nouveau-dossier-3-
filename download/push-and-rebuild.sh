#!/bin/bash
# push-and-rebuild.sh
# One-click script to push the Prisma symlink fix to GitHub and trigger Space-Z rebuild
#
# PREREQUISITES:
#   1. A GitHub PAT with Contents:Write permission for the repo
#      Create at: https://github.com/settings/personal-access-tokens/new
#   2. Or SSH access to the repo configured in ~/.ssh
#
# USAGE:
#   chmod +x push-and-rebuild.sh
#   ./push-and-rebuild.sh [GITHUB_PAT]
#
# If no PAT is provided, it will use your existing git credentials (SSH or cached HTTPS)

set -euo pipefail

REPO="younestsouli2019-bot/Nouveau-dossier-3-"
BRANCH="main"
BUNDLE="deploy-fix-prisma-symlink.bundle"

echo "=== HIT Swarm — Push & Rebuild Script ==="
echo ""

# Step 1: Clone/fetch the repo
WORKDIR=$(mktemp -d)
trap "rm -rf $WORKDIR" EXIT

echo "[1/5] Cloning repository..."
if [ -n "${1:-}" ]; then
  git clone "https://x-access-token:$1@github.com/$REPO.git" "$WORKDIR/repo" --depth=1
else
  git clone "git@github.com:$REPO.git" "$WORKDIR/repo" --depth=1 2>/dev/null || \
  git clone "https://github.com/$REPO.git" "$WORKDIR/repo" --depth=1
fi

cd "$WORKDIR/repo"

echo "[2/5] Fetching fix bundle..."
git bundle verify "$OLDPWD/$BUNDLE" 2>&1 || { echo "ERROR: Bundle verification failed!"; exit 1; }
git fetch "$OLDPWD/$BUNDLE" $BRANCH:bundle-fix

echo "[3/5] Merging fix commits..."
git merge bundle-fix --no-edit || { echo "ERROR: Merge conflict — resolve manually"; exit 1; }

echo "[4/5] Pushing to GitHub..."
git push origin $BRANCH

echo "[5/5] Triggering Space-Z rebuild..."
# The deploy-space-z.yml workflow triggers on push to main
# Space-Z will automatically rebuild via GitHub webhook
echo "Push to main detected → GitHub webhook → Space-Z auto-rebuild triggered!"
echo ""
echo "Wait 3-5 minutes, then verify:"
echo "  curl -s -o /dev/null -w '%{http_code}' https://x1he4604ap01-deploy.space-z.ai/api/healthz"
echo "  curl -s -o /dev/null -w '%{http_code}' https://t1trn6kunnv1-d.space-z.ai/api/healthz"
echo "  curl -s -o /dev/null -w '%{http_code}' https://b1fx661hzse0-d.space-z.ai/api/healthz"
echo ""
echo "=== Done! ==="
