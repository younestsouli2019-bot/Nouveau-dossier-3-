#!/usr/bin/env bash
# apply-scheduler-combined-20260907.sh — ONE COMMAND, owner-applied.
#
# The agent PAT lacks `workflow` scope, so GitHub rejects any push touching
# .github/workflows/*. Run this from the repo root on an org-authorized
# account to apply BOTH scheduler steps in one commit:
#
#   1. Settlement watchdog (diagnose-only, no money movement) — runs
#      scripts/run-watchdogs.ts in the hourly autonomous-tick job.
#   2. Hands-free payout pipeline tick (fail-closed) — POST /api/payouts/tick
#      each hour; advances the payout state machine through legal transitions
#      only. Skips cleanly (nothing moves) unless BOTH secrets are set.
#
# After applying, set these repo Actions secrets (Settings → Secrets → Actions):
#   PAYOUT_TICK_URL     — optional; defaults to VERCEL_PROJECT_URL if unset
#   PAYOUT_TICK_SECRET  — MUST match the deployment env's PAYOUT_TICK_SECRET
#                         (the endpoint 503s without it — fail-closed)
#
# And set the SAME PAYOUT_TICK_SECRET in the deployment env (Vercel / Space-Z)
# so the endpoint accepts the hourly call.
#
# Usage:  bash apply-scheduler-combined-20260907.sh
set -euo pipefail

PATCH="patches/scheduler-combined-20260907.patch"

if [ ! -f "$PATCH" ]; then
  echo "ERROR: $PATCH not found — run from the repo root." >&2
  exit 1
fi

echo "==> Checking patch applies to current HEAD..."
git apply --check --verbose "$PATCH"

echo "==> Applying patch..."
git apply "$PATCH"

echo "==> Verifying workflow YAML parses..."
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/autonomous-scheduler.yml')); print('YAML OK')" \
  || echo "WARNING: pyyaml not available — skipping YAML parse check"

echo ""
echo "Patch applied. Now:"
echo "  1) git add .github/workflows/autonomous-scheduler.yml"
echo "  2) git commit -m 'ci(scheduler): add settlement watchdog + hands-free payout tick (combined patch)'"
echo "  3) git push origin main"
echo "  4) Set repo secrets PAYOUT_TICK_SECRET (+ optional PAYOUT_TICK_URL)"
echo "     and the SAME PAYOUT_TICK_SECRET in the deployment env."
echo ""
echo "Until SWARM_LIVE + rail credentials are enabled, the tick runs the full"
echo "state machine but every submit fails closed — no money can move."
