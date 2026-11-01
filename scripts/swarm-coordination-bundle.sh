#!/usr/bin/env bash
set -euo pipefail

# swarm-coordination-bundle.sh
# Ready-to-run bundle for Base44/Swarm orchestration, sync, push, and optional commit/push.
#
# Examples:
#   ./scripts/swarm-coordination-bundle.sh --sync --daemon --with-test-data
#   ./scripts/swarm-coordination-bundle.sh --sync --push-base44 --commit --push --branch main
#   ./scripts/swarm-coordination-bundle.sh --sync --daemon --push-base44 --commit --push --remote origin --branch main
#
# Environment variables (from .env or exported shell):
#   BASE44_APP_ID
#   BASE44_SERVICE_TOKEN
#   BASE44_SERVER_URL or BASE44_API_URL
#   OWNER_PAYPAL_EMAIL, OWNER_PAYONEER_EMAIL, TRUST_WALLET_ADDRESS, etc. if needed

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

SYNC=false
PUSH_BASE44=false
DAEMON=false
COMMIT=false
PUSH=false
WITH_TEST_DATA=false
REMOTE="origin"
BRANCH=""
COMMIT_MSG="chore: swarm sync and Base44 orchestration"

usage() {
  cat <<'EOF'
Usage: ./scripts/swarm-coordination-bundle.sh [options]

Options:
  --sync                Run Base44 sync: node scripts/sync-base44-agents.mjs
  --push-base44         Run Base44 deployment push: node scripts/push-to-base44.mjs
  --daemon              Start swarm autopilot daemon in background
  --with-test-data      Include test data in Base44 push
  --commit              Git add/commit repo changes
  --push                Git push after commit (requires repo remote)
  --remote NAME         Git remote name (default: origin)
  --branch NAME         Git branch override (auto-detect if omitted)
  --commit-message MSG  Commit message for git commit
  -h, --help            Show this help

Notes:
  - Use .env or export env vars before running.
  - Base44 credentials are required for sync/push.
  - Daemon runs as a background process using nohup.
EOF
}

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sync) SYNC=true; shift ;;
    --push-base44) PUSH_BASE44=true; shift ;;
    --daemon) DAEMON=true; shift ;;
    --commit) COMMIT=true; shift ;;
    --push) PUSH=true; shift ;;
    --with-test-data) WITH_TEST_DATA=true; shift ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --commit-message) COMMIT_MSG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

require_cmd node
require_cmd git

# Load .env if present
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${BRANCH}" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
fi

check_base44_needed=false
if [[ "${SYNC}" == "true" || "${PUSH_BASE44}" == "true" ]]; then
  check_base44_needed=true
fi

if [[ "${check_base44_needed}" == "true" ]]; then
  for required in BASE44_APP_ID BASE44_SERVICE_TOKEN; do
    if [[ -z "${!required:-}" ]]; then
      echo "Missing required environment variable: ${required}" >&2
      echo "Export it or add it to .env before running this bundle." >&2
      exit 1
    fi
  done
fi

run_sync() {
  log "Syncing Base44 agents / missions / workflows / coordination"
  node ./scripts/sync-base44-agents.mjs
}

run_push_base44() {
  log "Pushing Base44 schemas and deployment state"
  if [[ "${WITH_TEST_DATA}" == "true" ]]; then
    node ./scripts/push-to-base44.mjs --with-test-data
  else
    node ./scripts/push-to-base44.mjs
  fi
}

start_daemon() {
  mkdir -p logs data/swarm_autonomy
  log "Starting swarm autonomy daemon in background"
  nohup node ./scripts/swarm-autonomy-daemon.mjs > logs/swarm-autonomy-daemon.log 2>&1 &
  echo $! > logs/swarm-autonomy-daemon.pid
  log "Background daemon started with PID $(cat logs/swarm-autonomy-daemon.pid)"
}

perform_commit() {
  if git diff --quiet --ignore-submodules -- && git diff --cached --quiet --ignore-submodules --; then
    log "No changes detected; skipping git commit"
    return 0
  fi

  log "Staging all tracked changes for commit"
  git add -A
  git commit -m "${COMMIT_MSG}"
}

perform_push() {
  if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
    echo "Remote '${REMOTE}' not found in this repository" >&2
    exit 1
  fi

  log "Pushing to ${REMOTE}/${BRANCH}"
  git push "${REMOTE}" "${BRANCH}"
}

if [[ "${SYNC}" == "true" ]]; then
  run_sync
fi

if [[ "${PUSH_BASE44}" == "true" ]]; then
  run_push_base44
fi

if [[ "${DAEMON}" == "true" ]]; then
  start_daemon
fi

if [[ "${COMMIT}" == "true" ]]; then
  perform_commit
fi

if [[ "${PUSH}" == "true" ]]; then
  perform_push
fi

log "Swarm coordination bundle complete"
log "Commands executed: sync=${SYNC} push_base44=${PUSH_BASE44} daemon=${DAEMON} commit=${COMMIT} push=${PUSH}"
