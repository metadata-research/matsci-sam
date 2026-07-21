#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/update-superego-proxy.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/nginx/matsci-sam.conf" \
  /etc/nginx/sites-available/matsci-sam
ln -sfn /etc/nginx/sites-available/matsci-sam \
  /etc/nginx/sites-enabled/matsci-sam
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

echo "Superego nginx now accepts the Ego public proxy."
