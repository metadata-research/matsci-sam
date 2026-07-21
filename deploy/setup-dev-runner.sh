#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/setup-dev-runner.sh" >&2
  exit 1
fi

RUNNER_VERSION=2.334.0
RUNNER_SHA256=048024cd2c848eb6f14d5646d56c13a4def2ae7ee3ad12122bee960c56f3d271
RUNNER_ARCHIVE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
RUNNER_DIR=/opt/actions-runner-superego
RUNNER_USER=matsci-runner
RUNNER_GROUP=matsci-runner
APP_USER=matsci-sam
APP_GROUP=matsci-sam
TOKEN_FILE=${1:-/tmp/matsci-sam-runner-token}
REPOSITORY_URL=https://github.com/metadata-research/matsci-yamz

if ! getent group "${APP_GROUP}" >/dev/null || ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "Run deploy/bootstrap-server.sh before setting up the runner." >&2
  exit 1
fi

if ! getent group "${RUNNER_GROUP}" >/dev/null; then
  groupadd --system "${RUNNER_GROUP}"
fi

if ! id "${RUNNER_USER}" >/dev/null 2>&1; then
  useradd \
    --system \
    --gid "${RUNNER_GROUP}" \
    --groups "${APP_GROUP}" \
    --home-dir /var/lib/matsci-runner \
    --create-home \
    --shell /bin/bash \
    "${RUNNER_USER}"
else
  usermod --append --groups "${APP_GROUP}" "${RUNNER_USER}"
fi

install -d -o "${RUNNER_USER}" -g "${RUNNER_GROUP}" -m 0750 "${RUNNER_DIR}"

if [[ -e "${RUNNER_DIR}/.runner" ]]; then
  echo "The runner is already registered at ${RUNNER_DIR}; resuming service setup."
else
  if [[ ! -r "${TOKEN_FILE}" ]]; then
    echo "Runner registration token file is missing: ${TOKEN_FILE}" >&2
    exit 1
  fi

  runner_tmp=$(mktemp -d)
  trap 'rm -rf -- "${runner_tmp}"; rm -f -- "${TOKEN_FILE}"' EXIT
  curl --fail --location --silent --show-error \
    "${RUNNER_URL}" \
    -o "${runner_tmp}/${RUNNER_ARCHIVE}"
  printf '%s  %s\n' "${RUNNER_SHA256}" "${runner_tmp}/${RUNNER_ARCHIVE}" |
    sha256sum --check --strict
  tar --extract --gzip \
    --file "${runner_tmp}/${RUNNER_ARCHIVE}" \
    --directory "${RUNNER_DIR}"

  (
    cd "${RUNNER_DIR}"
    ./bin/installdependencies.sh
  )
  chown -R "${RUNNER_USER}:${RUNNER_GROUP}" "${RUNNER_DIR}"

  runner_token=$(<"${TOKEN_FILE}")
  if [[ -z "${runner_token}" ]]; then
    echo "Runner registration token is empty." >&2
    exit 1
  fi

  runuser -u "${RUNNER_USER}" -- \
    "${RUNNER_DIR}/config.sh" \
    --unattended \
    --url "${REPOSITORY_URL}" \
    --token "${runner_token}" \
    --name superego-dev \
    --work _work \
    --labels superego-dev \
    --no-default-labels
  unset runner_token

  rm -rf -- "${runner_tmp}"
  rm -f -- "${TOKEN_FILE}"
  trap - EXIT
fi

cat >/etc/sudoers.d/matsci-sam-runner <<'EOF'
Cmnd_Alias MATSCI_SAM_SERVICE = /usr/bin/systemctl restart matsci-sam.service, /usr/bin/systemctl is-active matsci-sam.service
matsci-runner ALL=(root) NOPASSWD: MATSCI_SAM_SERVICE
matsci-runner ALL=(matsci-sam) NOPASSWD: ALL
EOF
chmod 0440 /etc/sudoers.d/matsci-sam-runner
visudo --check --file /etc/sudoers.d/matsci-sam-runner

(
  cd "${RUNNER_DIR}"
  if [[ ! -f .service ]]; then
    ./svc.sh install "${RUNNER_USER}"
  fi
  ./svc.sh start
)

echo "The superego-dev runner is installed and running from ${RUNNER_DIR}."
