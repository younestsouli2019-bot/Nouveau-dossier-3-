#!/usr/bin/env bash
# apply-owner-workflows-v3-20260907.sh — ONE COMMAND, owner-applied (final piece).
#
# Part A of the v2 bundle (the 3 deadlock repairs) already landed on main at
# 8b31eff — this v3 patch is the remaining delta (parts B+C). The agent PAT
# is an OAuth App without `workflow` scope, so GitHub refuses agent pushes
# touching .github/workflows/*; run this from the repo root on an
# org-authorized account to finish in ONE commit:
#
#   B) autonomous-scheduler.yml autonomous-tick job gains:
#      - Settlement watchdog (diagnose-only, no money movement) — hourly
#        scripts/run-watchdogs.ts tick.
#      - Hands-free payout pipeline tick (fail-closed) — hourly POST
#        /api/payouts/tick advancing the payout state machine through legal
#        transitions only. Skips cleanly unless PAYOUT_TICK_SECRET is set;
#        defaults to VERCEL_PROJECT_URL when PAYOUT_TICK_URL is unset.
#   C) NEW .github/workflows/devops-self-healing.yml — hourly self-healing
#      loop: blocking pre-flight sanitization (static engine), control-plane
#      logless-deadlock scan (dynamic engine), auto-repair, circuit breaker
#      (>3 sequential triggers -> emergency webhook), auto-commit of
#      repairs. Checkout uses SELF_HEALING_TOKEN when present so repair
#      pushes succeed; falls back to github.token otherwise.
#
# Repo Actions secrets to set afterwards:
#   PAYOUT_TICK_SECRET (and same value in the deployment env) — enables the
#     hands-free payout tick endpoint (endpoint 503s without it — fail-closed)
#   PAYOUT_TICK_URL — optional; defaults to VERCEL_PROJECT_URL
#   SELF_HEALING_TOKEN (or GITHUB_PAT_WORKFLOW_SCOPE) — PAT with repo+workflow
#     scope so the hourly loop can PUSH workflow-file repairs autonomously
#   SELF_HEAL_ALERT_WEBHOOK — emergency channel for circuit-breaker trips
#
# Usage:  bash apply-owner-workflows-v3-20260907.sh
set -euo pipefail

PATCH="patches/owner-workflows-v3-20260907.patch"

if [ ! -f "$PATCH" ]; then
  echo "ERROR: $PATCH not found — run from the repo root." >&2
  exit 1
fi

echo "==> Pre-flight: static engine on current workflows..."
npx tsx scripts/devops-self-healing.ts sanitize --check .github/workflows \
  && echo "CLEAN (part A repairs already on main)" || true

echo "==> Checking patch applies to current HEAD..."
git apply --check --verbose "$PATCH"

echo "==> Applying patch..."
git apply "$PATCH"

echo "==> Post-flight: static engine must report CLEAN..."
npx tsx scripts/devops-self-healing.ts sanitize --check .github/workflows
echo "CLEAN ✓"

echo "==> Verifying workflow YAML parses..."
for f in .github/workflows/autonomous-scheduler.yml \
         .github/workflows/devops-self-healing.yml; do
  [ -f "$f" ] && python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "YAML OK: $f"
done

echo ""
echo "Patch applied. Now commit and push:"
echo "  git add .github/workflows/"
echo "  git commit -m 'ci(self-healing): scheduler watchdog + payout tick steps, hourly self-healing workflow (v3)'"
echo "  git push origin main"
echo ""
echo "Then set the repo Actions secrets (see header of this script) and, if"
echo "desired, install the local pre-commit guard:"
echo "  git config core.hooksPath .githooks"
