#!/usr/bin/env bash
# Convenience: push the fix + verify, using GH_TOKEN from env.
# Usage: GH_TOKEN=ghp_xxx ./apply.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "ERROR: set GH_TOKEN env var first." >&2
  echo "  export GH_TOKEN=ghp_xxx" >&2
  exit 2
fi

echo "==> Pushing fix via GitHub API..."
node push-owner-handsfree-fix.mjs

echo
echo "==> Verifying..."
node verify-fix.mjs
