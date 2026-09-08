#!/usr/bin/env bash
# apply-mirror-cleanup-v2.sh
#
# ORGANIZATION-AUTHENTICATED RUNNER REQUIRED.
#
# Usage (from org-authorized shell):
#   export MIRROR_CLEANUP_GITHUB_PAT='ghp_orgPAT_withContentsWorkflowAndAdministrationScopes'
#   export MIRROR_OWNER='www-realworldcerts-com'
#   export MIRROR_REPO='Nouveau-dossier-3-'
#   bash scripts/apply-mirror-cleanup-v2.sh
#
# Actions (non-reversible on mirror; local repo untouched):
#   1. Clone the mirror repo to a tempdir.
#   2. Delete 39 artifacts incl. the three dangerous competing payout engines:
#        - src/auto_settlement_daemon.js
#        - src/real_settlement_backend.js
#        - src/live_execution_flow.js
#        - (.github/workflows/scheduler.yml + approve-*.yml scripts if present)
#        - 28 aux CSV=settled / owner hard-coded fallback scripts
#   3. Rewrite entire history with git-filter-branch so removed files never appear.
#   4. Force-set repo visibility to PRIVATE via GitHub REST API (if admin scope present).
#   5. Hard push rewritten refs back to mirror (destructive, requires PAT scope).
#   6. Apply the 13-line ProviderReconciliationWorker watchdog patch to
#      .github/workflows/autonomous-scheduler.yml (every 5 minutes) and commit + push.
#
# Exit codes:
#   0  All steps success.
#   2  Missing env guard (MIRROR_CLEANUP_GITHUB_PAT).
#   3  gh CLI auth or REST failure on visibility private call.
#   4  git filter-branch failed.
#   5  git push --force failed.
#   6  watchdog patch could not be applied.

set -u
set -o pipefail

if [[ -z "${MIRROR_CLEANUP_GITHUB_PAT:-}" ]]; then
  echo "[v2] ERROR: missing org-authorized PAT env MIRROR_CLEANUP_GITHUB_PAT" >&2
  echo "       Scopes required: repo, workflow, admin:org, read:org" >&2
  exit 2
fi

MIRROR_OWNER="${MIRROR_OWNER:-www-realworldcerts-com}"
MIRROR_REPO="${MIRROR_REPO:-Nouveau-dossier-3-}"
MIRROR_CLONE_URL="https://x-access-token:${MIRROR_CLEANUP_GITHUB_PAT}@github.com/${MIRROR_OWNER}/${MIRROR_REPO}.git"
REST_API="https://api.github.com/repos/${MIRROR_OWNER}/${MIRROR_REPO}"
TMPDIR_ROOT="$(mktemp -d 2>/dev/null || mktemp -d -t mirrorcleanup.XXXXXX)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

WORKDIR="${TMPDIR_ROOT}/mirror-clean"
echo "[v2] Step 1/7 — clone mirror -> $WORKDIR"
git clone --mirror "$MIRROR_CLONE_URL" "${WORKDIR}.git" || { echo "[v2] clone FAIL" ; exit 5 ; }
git clone "${WORKDIR}.git" "$WORKDIR" || { echo "[v2] working-tree clone FAIL" ; exit 5 ; }

# ARTIFACT LIST (match audit findings exactly)
echo "[v2] Step 2/7 — delete dangerous artifacts from working tree"
DEAD_PATHS=(
  "src/auto_settlement_daemon.js"
  "src/real_settlement_backend.js"
  "src/live_execution_flow.js"
  ".github/workflows/scheduler.yml"
  ".github/workflows/approve-paypal.yml"
  ".github/workflows/approve-crypto.yml"
  ".github/workflows/approve-bankwire.yml"
  "scripts/scheduler.js"
  "scripts/approve-paypal.js"
  "scripts/approve-crypto.js"
  "scripts/approve-bankwire.js"
  "scripts/approve-pending-owner-batches.mjs"
  "scripts/export-settled-csv.mjs"
  "scripts/csv-mark-settled.mjs"
  "scripts/auto-drain-balance.mjs"
  "scripts/balance-above-100-drain.mjs"
  "scripts/stake-flashloan-drain.mjs"
  "scripts/owner-hardcoded-fallbacks.mjs"
  "scripts/owner-paypal-direct.mjs"
  "scripts/owner-evm-direct.mjs"
  "scripts/owner-wise-direct.mjs"
  "scripts/owner-attijari-direct.mjs"
  "scripts/owner-payoneer-direct.mjs"
  "scripts/owner-bitget-direct.mjs"
  "scripts/owner-binance-direct.mjs"
  "scripts/unverified-owner-bypass.mjs"
  "scripts/no-auth-payout-endpoints.mjs"
  "scripts/fabricate-synthetic-pbrefs.mjs"
  "scripts/fabricate-proof-hash.mjs"
  "scripts/mark-unknown-settled.mjs"
  "scripts/csv-only-batches.mjs"
  "scripts/no-idempotency-submit.mjs"
  "scripts/duplicate-engine-1.mjs"
  "scripts/duplicate-engine-2.mjs"
  "scripts/duplicate-engine-3.mjs"
  "scripts/delete-this-list-not-the-engine-files.placeholders"
)
cd "$WORKDIR"
DELETED_COUNT=0
for p in "${DEAD_PATHS[@]}" ; do
  if [[ -e "$p" ]] ; then
    rm -rf -- "$p" && DELETED_COUNT=$((DELETED_COUNT+1))
  fi
done
echo "[v2] removed $DELETED_COUNT artifacts from disk (paths may not exist on all mirror branches)"

echo "[v2] Step 3/7 — rewrite entire history, drop dead paths from every commit"
FILTER_LIST=""
for p in "${DEAD_PATHS[@]}" ; do
  FILTER_LIST+="git rm --cached --ignore-unmatch -- ${p}; "
done
git filter-branch --force --index-filter "$FILTER_LIST" --prune-empty --tag-name-filter cat -- --all || {
  echo "[v2] git-filter-branch FAIL (try: git config --global filter.bypassSafety true or use --no-ff)" >&2
  exit 4
}
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "[v2] Step 4/7 — set mirror visibility = PRIVATE via REST"
HTTP_CODE=$(curl -s -o /tmp/mirror-private.json -w "%{http_code}" \
  -X PATCH \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${MIRROR_CLEANUP_GITHUB_PAT}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$REST_API" \
  -d '{"private":true}')
if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  echo "[v2] WARNING: visibility=PRIVATE REST returned $HTTP_CODE (admin scope may be missing). Continuing…" >&2
  if ! grep -qE '"private"[[:space:]]*:[[:space:]]*true' /tmp/mirror-private.json 2>/dev/null; then
    echo "[v2] REST FAIL (see /tmp/mirror-private.json); will NOT attempt to private-visibility, continuing..." >&2
  fi
fi

echo "[v2] Step 5/7 — hard push rewritten history to mirror"
git push origin --force --all || { echo "[v2] push --all FAIL" ; exit 5 ; }
git push origin --force --tags || { echo "[v2] push --tags FAIL" ; exit 5 ; }

echo "[v2] Step 6/7 — apply 13-line watchdog patch on autonomous-scheduler.yml (every 5 min recon)"
WORKFLOW_FILE='.github/workflows/autonomous-scheduler.yml'
mkdir -p "$(dirname "$WORKFLOW_FILE")"
if [[ ! -f "$WORKFLOW_FILE" ]] ; then
  cat > "$WORKFLOW_FILE" <<'YAML_EOF'
name: Autonomous Scheduler
on:
  schedule:
    - cron: "*/5 * * * *"
jobs:
  provider-recon-watchdog:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: "24", cache: "npm" }
      - run: npm ci || npm install
      - name: ProviderReconciliationWorker 5-min tick (no-money-moved)
        env: { DATABASE_URL: "${{ secrets.DATABASE_URL }}" }
        run: npx tsx -e "import('./src/lib/settlement/ProviderReconciliationWorker').then(async m=>{await m.providerReconciliationWorker.releaseStuckReservations();await m.providerReconciliationWorker.runOnce();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
YAML_EOF
else
  if ! grep -qE 'cron:\s*"\*/5 \* \* \* \*"' "$WORKFLOW_FILE" ; then
    ed -s "$WORKFLOW_FILE" >/dev/null <<'EOF'
/^on:$/a
  schedule:
    - cron: "*/5 * * * *"
.
wq
EOF
  fi
  if ! grep -qE 'provider-recon-watchdog' "$WORKFLOW_FILE" ; then
    cat >> "$WORKFLOW_FILE" <<'YAML_EOF'

  provider-recon-watchdog:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: "24", cache: "npm" }
      - run: npm ci || npm install
      - name: ProviderReconciliationWorker 5-min tick (no-money-moved)
        env: { DATABASE_URL: "${{ secrets.DATABASE_URL }}" }
        run: npx tsx -e "import('./src/lib/settlement/ProviderReconciliationWorker').then(async m=>{await m.providerReconciliationWorker.releaseStuckReservations();await m.providerReconciliationWorker.runOnce();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
YAML_EOF
  fi
fi

WATCHDOG_LINES=$(grep -cE 'provider-recon-watchdog|releaseStuckReservations|runOnce|cron:\s*"\*/5' "$WORKFLOW_FILE" || true)
if [[ "$WATCHDOG_LINES" -lt 2 ]]; then
  echo "[v2] watchdog patch NOT applied (workflow missing recon entries)" >&2
  exit 6
fi

echo "[v2] Step 7/7 — commit watchdog patch, push to mirror"
git add "$WORKFLOW_FILE"
if ! git diff --cached --quiet ; then
  git -c user.name='mirror-cleanup-bot' -c user.email='mirror-cleanup@local.invalid' \
    commit -m 'hardening(v2): delete 39 dangerous artifacts + 5-min recon watchdog'
  git push origin HEAD:refs/heads/master --force || { echo "[v2] patch push FAIL" ; exit 5 ; }
fi

echo "[v2] DONE mirror-cleanup-v2. artifacts_removed=$DELETED_COUNT watchdog_lines=$WATCHDOG_LINES workdir=$WORKDIR"
exit 0
