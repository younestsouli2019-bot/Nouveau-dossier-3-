#!/usr/bin/env bash
# apply-owner-workflows-v2-20260907.sh — ONE COMMAND, owner-applied.
#
# The agent PAT lacks `workflow` scope, so GitHub rejects any push touching
# .github/workflows/*. Run this from the repo root on an org-authorized
# account. This CUMULATIVE patch supersedes the v1 combined scheduler patch
# (apply-v1-20260907) and bundles EVERYTHING workflow-related in one commit:
#
#   A. STATIC ENGINE REPAIRS — fixes 3 live deadlock hazards found by the
#      static pre-flight engine (child `concurrency:` groups duplicating
#      their workflow-level parent — the logless-deadlock pattern from the
#      Autonomous Self-Healing Blueprint):
#        - autonomous-scheduler.yml   (job `autonomous-tick`)
#        - owner-crypto-withdraw.yml  (job `withdraw`)
#        - owner-payout.yml           (job `execute`)
#   B. SCHEDULER STEPS (from v1): settlement watchdog (diagnose-only) +
#      hands-free payout pipeline tick (fail-closed) in the hourly
#      autonomous-tick job.
#   C. NEW WORKFLOW: devops-self-healing.yml — hourly self-healing loop:
#      blocking static pre-flight, control-plane deadlock scan + repair,
#      circuit breaker (>3 sequential triggers → SELF_HEAL_ALERT_WEBHOOK),
#      auto-commit of repairs.
#
# Idempotent: if you already applied the v1 combined scheduler patch, this
# script detects it and applies with `--3way` merge so only the new parts land.
#
# Optional repo Actions secrets afterwards:
#   SELF_HEALING_TOKEN (or GITHUB_PAT_WORKFLOW_SCOPE) — PAT with repo+workflow
#   scope so the hourly loop can PUSH workflow-file repairs autonomously.
#   Without it: scan/triage/alert work, repair pushes are rejected by GitHub.
#   SELF_HEAL_ALERT_WEBHOOK — emergency webhook (Slack/Discord/custom) that
#   fires when the circuit breaker trips (engine-level malfunction alert).
#
# Usage:  bash apply-owner-workflows-v2-20260907.sh
set -euo pipefail

PATCH="patches/owner-workflows-v2-20260907.patch"

if [ ! -f "$PATCH" ]; then
  echo "ERROR: $PATCH not found — run from the repo root." >&2
  exit 1
fi

echo "==> Pre-flight: current workflow hazards (the engine will fix them)..."
npx tsx scripts/devops-self-healing.ts sanitize --check .github/workflows || true

echo "==> Applying cumulative v2 patch (3-way aware)..."
if git apply --check "$PATCH" 2>/dev/null; then
  git apply --verbose "$PATCH"
elif git apply --3way "$PATCH" 2>/dev/null; then
  echo "Applied with 3-way merge (v1 scheduler steps were already present)."
else
  echo "ERROR: patch does not apply — repo state diverged. Inspect with:" >&2
  echo "  git apply --3way --verbose $PATCH" >&2
  exit 1
fi

echo "==> Post-flight: static engine must report CLEAN..."
npx tsx scripts/devops-self-healing.ts sanitize --check .github/workflows
echo "CLEAN ✓"

echo "==> Verifying workflow YAML parses..."
for f in .github/workflows/autonomous-scheduler.yml \
         .github/workflows/owner-crypto-withdraw.yml \
         .github/workflows/owner-payout.yml \
         .github/workflows/devops-self-healing.yml; do
  [ -f "$f" ] && python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "YAML OK: $f"
done

echo ""
echo "Patch applied. Now commit and push:"
echo "  git add .github/workflows/"
echo "  git commit -m 'ci(devops): self-healing v2 — static-engine deadlock repairs, scheduler steps, hourly self-healing loop'"
echo "  git push origin main"
echo ""
echo "Optional repo Actions secrets (self-healing wiring):"
echo "  SELF_HEALING_TOKEN (or GITHUB_PAT_WORKFLOW_SCOPE) — PAT with"
echo "    repo+workflow scope so the hourly loop can PUSH workflow-file"
echo "    repairs autonomously (GitHub refuses GITHUB_TOKEN for workflow"
echo "    file updates; without it: scan/triage/alert still work)."
echo "  SELF_HEAL_ALERT_WEBHOOK — emergency channel for breaker trips."
echo "The self-healing workflow starts on its next hourly cron automatically."
echo ""
echo "Install the local pre-commit guard (Static Engine at commit time):"
echo "  git config core.hooksPath .githooks"
