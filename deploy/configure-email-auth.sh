#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/configure-email-auth-remote.sh
client_file=${MATSCI_GMAIL_CLIENT_FILE:-/home/chris/.config/matsci-sam/google-mail-oauth-client.json}
token_file=${MATSCI_GMAIL_TOKEN_FILE:-/home/chris/.config/matsci-sam/google-mail-token.json}
target=${1:-}
action=${2:-}
check_only=false
work_dir=
remote_dir=
remote_staged=false

usage() {
  cat <<'USAGE'
Usage: deploy/configure-email-auth.sh <superego|ego> <stage|enable|disable> [--check-only]

Safely install the existing local Gmail send-only credentials and set the
passwordless-email feature flags in the selected protected runtime settings.

  stage     Install or refresh credentials with both feature flags false.
  enable    Install or refresh credentials and enable sign-in and registration.
  disable   Set both feature flags false without changing sender credentials.

The command does not restart or deploy the application. A reviewed release
must follow an enable or disable operation before built pages reflect it.
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${remote_staged} == true && -n ${remote_dir} ]]; then
    ssh -o BatchMode=yes "${ssh_host}" \
      "if [[ -d '${remote_dir}' && ! -L '${remote_dir}' ]]; then
         find '${remote_dir}' -mindepth 1 -delete 2>/dev/null || true
         rmdir '${remote_dir}' 2>/dev/null || true
       fi" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n ${work_dir} && -d ${work_dir} ]]; then
    find "${work_dir}" -mindepth 1 -delete
    rmdir "${work_dir}"
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

case ${target} in
  superego)
    ssh_host=superego
    admin_workspace=/home/cr625/superego-admin
    ;;
  ego)
    ssh_host=ego
    admin_workspace=/home/cr625/ego-admin
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

case ${action} in
  stage|enable|disable)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

shift 2
while (($#)); do
  case $1 in
    --check-only)
      check_only=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

for command in awk base64 date find git id install mktemp node rmdir scp \
  sha256sum ssh stat
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

[[ -f ${remote_helper} && ! -L ${remote_helper} ]] ||
  fail "The reviewed remote email-auth helper is unavailable."
git -C "${repo}" fetch --prune origin dev
[[ -z $(git -C "${repo}" status --porcelain=v1) ]] ||
  fail "Run from a clean reviewed checkout."
candidate=$(git -C "${repo}" rev-parse HEAD)
[[ ${candidate} == "$(git -C "${repo}" rev-parse refs/remotes/origin/dev)" ]] ||
  fail "The checkout must equal the reviewed origin/dev commit."

if [[ ${action} != disable ]]; then
  for protected_file in "${client_file}" "${token_file}"; do
    [[ -f ${protected_file} && ! -L ${protected_file} ]] ||
      fail "A protected Gmail sender file is unavailable: ${protected_file}"
    [[ $(stat -c '%U:%a' "${protected_file}") == "$(id -un):600" ]] ||
      fail "A protected Gmail sender file must be owned by the current user with mode 0600."
  done
fi

work_dir=$(mktemp -d)
payload=${work_dir}/email-auth-settings.json

node - "${action}" "${client_file}" "${token_file}" "${payload}" <<'NODE'
const fs = require("node:fs")

const [, , action, clientPath, tokenPath, outputPath] = process.argv
let settings

if (action === "disable") {
  settings = {
    EMAIL_AUTH_ENABLED: "false",
    EMAIL_AUTH_ACCOUNT_CREATION_ENABLED: "false"
  }
} else {
  const clientDocument = JSON.parse(fs.readFileSync(clientPath, "utf8"))
  const tokenDocument = JSON.parse(fs.readFileSync(tokenPath, "utf8"))
  const client = clientDocument.web
  const callbackUrl = "http://localhost:53682/oauth2callback"
  const sendScope = "https://www.googleapis.com/auth/gmail.send"

  if (!client?.client_id || !client.client_secret)
    throw new Error("The Gmail OAuth client file is incomplete")
  if (!client.redirect_uris?.includes(callbackUrl))
    throw new Error(`The Gmail OAuth client is missing ${callbackUrl}`)
  if (!tokenDocument.refresh_token)
    throw new Error("The Gmail OAuth refresh token is missing")
  if (tokenDocument.scope !== sendScope)
    throw new Error("The Gmail OAuth token does not record the send-only scope")

  const enabled = action === "enable" ? "true" : "false"
  settings = {
    EMAIL_AUTH_ENABLED: enabled,
    EMAIL_AUTH_ACCOUNT_CREATION_ENABLED: enabled,
    EMAIL_AUTH_PROVIDER: "gmail-api",
    EMAIL_AUTH_FROM: "matsci-sam@systemada.com",
    EMAIL_AUTH_GMAIL_CLIENT_ID: client.client_id,
    EMAIL_AUTH_GMAIL_CLIENT_SECRET: client.client_secret,
    EMAIL_AUTH_GMAIL_REFRESH_TOKEN: tokenDocument.refresh_token,
    EMAIL_AUTH_TOKEN_TTL_MINUTES: "15"
  }
}

fs.writeFileSync(outputPath, `${JSON.stringify(settings)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
})
NODE

payload_sha=$(sha256sum "${payload}" | awk '{print $1}')
helper_base64=$(base64 --wrap=0 "${remote_helper}")
remote_id="email-auth-$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote_dir="${admin_workspace}/incoming/${remote_id}"

ssh "${ssh_host}" "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp "${payload}" "${ssh_host}:${remote_dir}/email-auth-settings.json"

if [[ ${check_only} == true ]]; then
  remote_check=true
else
  remote_check=false
  [[ -t 0 ]] ||
    fail "Run interactively so sudo can confirm the protected configuration change."
fi

ssh -t "${ssh_host}" \
  "set -o pipefail
   /usr/bin/printf '%s' '${helper_base64}' |
   /usr/bin/base64 --decode |
   /usr/bin/sudo /bin/bash -s -- \
     '${remote_dir}/email-auth-settings.json' \
     '${target}' \
     '${payload_sha}' \
     '${action}' \
     '${remote_check}'"

ssh "${ssh_host}" \
  "if [[ -d '${remote_dir}' && ! -L '${remote_dir}' ]]; then
     find '${remote_dir}' -mindepth 1 -delete
     rmdir '${remote_dir}'
   fi"
remote_staged=false

if [[ ${check_only} == true ]]; then
  echo "Email-auth configuration check passed for ${target}."
else
  echo "Email-auth configuration ${action} completed for ${target}."
  echo "No service was restarted. Apply the setting through the reviewed release path."
fi
