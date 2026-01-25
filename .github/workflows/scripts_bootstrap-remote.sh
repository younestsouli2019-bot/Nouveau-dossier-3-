#!/usr/bin/env bash
set -euo pipefail
HOSTNAME="${HOSTNAME:-egress-node}"
RUNNER_VERSION="${RUNNER_VERSION:-2.320.0}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner}"
REPO_URL="${GH_REPO_URL}"
REG_TOKEN="${GH_RUNNER_REG_TOKEN}"
RUNNER_NAME="${RUNNER_NAME:-egress-$(hostname)}"
LABELS="${RUNNER_LABELS:-egress}"
AUTH_KEY="${TAILSCALE_AUTHKEY}"

sudo apt-get update -y
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key "${AUTH_KEY}" --advertise-exit-node --ssh

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"
curl -L -o "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
tar xzf "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
sudo ./bin/installdependencies.sh

./config.sh --url "${REPO_URL}" --token "${REG_TOKEN}" --name "${RUNNER_NAME}" --labels "${LABELS}" --unattended --replace
sudo ./svc.sh install
sudo ./svc.sh start

curl -fsSL https://ipinfo.io/json -o /opt/egress-ip.json
