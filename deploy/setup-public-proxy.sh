#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/setup-public-proxy.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PUBLIC_HOST=ego.cci.drexel.edu
UPSTREAM_HOST=10.246.250.19

if ! timeout 5 bash -c "</dev/tcp/${UPSTREAM_HOST}/80" >/dev/null 2>&1; then
  echo "Superego is not reachable at ${UPSTREAM_HOST}:80." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "Installing the public nginx proxy and Certbot..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/nginx/matsci-sam-public.conf" \
  /etc/nginx/sites-available/matsci-sam-public
ln -sfn /etc/nginx/sites-available/matsci-sam-public \
  /etc/nginx/sites-enabled/matsci-sam-public
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

echo
echo "The HTTP proxy for ${PUBLIC_HOST} is installed."
echo "Verify that public port 80 is reachable before requesting a certificate."
echo "Then run: sudo certbot --nginx --redirect -d ${PUBLIC_HOST}"
