#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
cd /

payload=${1:-}
target=${2:-}
expected_payload_sha=${3:-}
action=${4:-}
check_only=${5:-}
config=/etc/matsci-sam/app.env
admin_root=/var/lib/matsci-sam-admin
backup_root=${admin_root}/config-backups
partial=
payload_identity=

fail() {
  echo "$*" >&2
  exit 1
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ -n ${partial} && (-e ${partial} || -L ${partial}) ]]; then
    if [[ ${partial} =~ ^/etc/matsci-sam/[.]app[.]env[.][A-Za-z0-9]{8}$ &&
      -f ${partial} && ! -L ${partial} ]]
    then
      unlink "${partial}" || status=1
    else
      echo "Refusing to remove an unsafe protected-settings partial." >&2
      status=1
    fi
  fi

  if [[ -n ${payload_identity} && -f ${payload} && ! -L ${payload} &&
    $(stat -c '%d:%i' "${payload}") == "${payload_identity}" ]]
  then
    truncate --size=0 "${payload}" || status=1
    unlink "${payload}" || status=1
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in bash date hostname id install mkdir mktemp mv node sha256sum \
  stat truncate unlink
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

[[ $# -eq 5 ]] ||
  fail "The protected email-auth configuration request is malformed."
[[ $(id -u) -eq 0 ]] ||
  fail "Run this helper by streaming it to sudo bash."

case ${target} in
  superego)
    expected_hostname=cci-superego
    admin_workspace=/home/cr625/superego-admin
    ;;
  ego)
    expected_hostname=cci-ego
    admin_workspace=/home/cr625/ego-admin
    ;;
  *)
    fail "Unknown email-auth environment: ${target}"
    ;;
esac
case ${action} in
  stage|enable|disable)
    ;;
  *)
    fail "Unknown email-auth configuration action: ${action}"
    ;;
esac
[[ ${check_only} == true || ${check_only} == false ]] ||
  fail "The email-auth check-only value is invalid."
[[ $(hostname) == "${expected_hostname}" ]] ||
  fail "This helper runs only on ${expected_hostname}."
[[ ${expected_payload_sha} =~ ^[0-9a-f]{64}$ ]] ||
  fail "The expected email-auth payload digest is malformed."

payload_pattern="^${admin_workspace}/incoming/email-auth-[0-9]{8}T[0-9]{6}Z-[0-9]+/email-auth-settings[.]json$"
[[ ${payload} =~ ${payload_pattern} ]] ||
  fail "The email-auth payload is outside the reviewed incoming area."
payload_directory=${payload%/*}
[[ -d ${payload_directory} && ! -L ${payload_directory} &&
  $(stat -c '%U:%a' "${payload_directory}") == cr625:700 ]] ||
  fail "The email-auth payload directory is unsafe."
[[ -f ${payload} && ! -L ${payload} &&
  $(stat -c '%U:%a' "${payload}") == cr625:600 ]] ||
  fail "The email-auth payload is unsafe."
payload_identity=$(stat -c '%d:%i' "${payload}")
[[ $(sha256sum "${payload}" | awk '{print $1}') == \
  "${expected_payload_sha}" ]] ||
  fail "The email-auth payload digest does not match."

[[ -f ${config} && ! -L ${config} &&
  $(stat -c '%U:%G:%a' "${config}") == root:matsci-sam:640 ]] ||
  fail "The protected application environment is unsafe."
[[ -d ${admin_root} && ! -L ${admin_root} &&
  $(stat -c '%U:%G:%a' "${admin_root}") == root:root:700 ]] ||
  fail "The protected administration directory is unsafe."

partial=$(mktemp /etc/matsci-sam/.app.env.XXXXXXXX)

node - "${config}" "${payload}" "${partial}" "${action}" "${check_only}" <<'NODE'
const fs = require("node:fs")

const [, , configPath, payloadPath, outputPath, action, checkOnly] = process.argv
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"))
const original = fs.readFileSync(configPath, "utf8")
const allowedKeys = new Set([
  "EMAIL_AUTH_ENABLED",
  "EMAIL_AUTH_ACCOUNT_CREATION_ENABLED",
  "EMAIL_AUTH_PROVIDER",
  "EMAIL_AUTH_FROM",
  "EMAIL_AUTH_GMAIL_CLIENT_ID",
  "EMAIL_AUTH_GMAIL_CLIENT_SECRET",
  "EMAIL_AUTH_GMAIL_REFRESH_TOKEN",
  "EMAIL_AUTH_TOKEN_TTL_MINUTES"
])
const keys = Object.keys(payload)
const expectedKeys =
  action === "disable"
    ? ["EMAIL_AUTH_ENABLED", "EMAIL_AUTH_ACCOUNT_CREATION_ENABLED"]
    : [...allowedKeys]

if (
  keys.length !== expectedKeys.length ||
  expectedKeys.some((key) => !Object.hasOwn(payload, key)) ||
  keys.some((key) => !allowedKeys.has(key))
)
  throw new Error("The email-auth payload has an unexpected key set")

for (const [key, value] of Object.entries(payload)) {
  if (typeof value !== "string" || value.includes("\n") || value.includes("\r"))
    throw new Error(`The email-auth value for ${key} is invalid`)
}
if (!/^(?:true|false)$/.test(payload.EMAIL_AUTH_ENABLED))
  throw new Error("EMAIL_AUTH_ENABLED must be true or false")
if (!/^(?:true|false)$/.test(payload.EMAIL_AUTH_ACCOUNT_CREATION_ENABLED))
  throw new Error("EMAIL_AUTH_ACCOUNT_CREATION_ENABLED must be true or false")
if (
  payload.EMAIL_AUTH_ACCOUNT_CREATION_ENABLED === "true" &&
  payload.EMAIL_AUTH_ENABLED !== "true"
)
  throw new Error("Account creation requires email authentication")

if (action !== "disable") {
  if (payload.EMAIL_AUTH_PROVIDER !== "gmail-api")
    throw new Error("The staged email provider must be gmail-api")
  if (!/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(payload.EMAIL_AUTH_FROM))
    throw new Error("The staged From address is invalid")
  for (const key of [
    "EMAIL_AUTH_GMAIL_CLIENT_ID",
    "EMAIL_AUTH_GMAIL_CLIENT_SECRET",
    "EMAIL_AUTH_GMAIL_REFRESH_TOKEN"
  ]) {
    if (!/^[A-Za-z0-9._/-]+$/.test(payload[key]))
      throw new Error(`The staged credential format for ${key} is invalid`)
  }
  if (!/^(?:[5-9]|[1-5][0-9]|60)$/.test(payload.EMAIL_AUTH_TOKEN_TTL_MINUTES))
    throw new Error("The staged token lifetime is invalid")
}

const lines = original.split(/\r?\n/)
const counts = new Map()
for (const line of lines) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
  if (match && allowedKeys.has(match[1]))
    counts.set(match[1], (counts.get(match[1]) || 0) + 1)
}
for (const key of keys) {
  if ((counts.get(key) || 0) > 1)
    throw new Error(`The protected environment contains duplicate ${key} entries`)
}

const replacements = new Map(
  Object.entries(payload).map(([key, value]) => [key, `${key}='${value}'`])
)
const merged = []
for (const line of lines) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
  const replacement = match ? replacements.get(match[1]) : undefined
  if (replacement) {
    merged.push(replacement)
    replacements.delete(match[1])
  } else {
    merged.push(line)
  }
}
if (replacements.size) {
  if (merged.at(-1) !== "") merged.push("")
  merged.push("# Passwordless email authentication")
  merged.push(...replacements.values())
}
while (merged.length > 1 && merged.at(-1) === "" && merged.at(-2) === "")
  merged.pop()
const rendered = `${merged.join("\n").replace(/\n*$/, "")}\n`

if (checkOnly === "true") {
  let changes = 0
  for (const [key, value] of Object.entries(payload)) {
    const current = lines.find((line) => line.startsWith(`${key}=`))
    if (current !== `${key}='${value}'`) changes += 1
    const sensitive = key.includes("SECRET") || key.includes("REFRESH_TOKEN")
    const state = current ? "set" : "missing"
    if (sensitive) console.log(`${key}=${state}`)
    else if (key.endsWith("_ENABLED")) console.log(`${key}=would_be_${value}`)
    else console.log(`${key}=${state}`)
  }
  console.log(`changes_required=${changes}`)
} else {
  fs.writeFileSync(outputPath, rendered, { encoding: "utf8", mode: 0o600 })
}
NODE

if [[ ${check_only} == true ]]; then
  unlink "${partial}"
  partial=
  echo "Protected email-auth configuration check completed; no values were displayed."
  exit 0
fi

bash -n "${partial}" ||
  fail "The candidate protected environment is not valid shell syntax."

mkdir -p "${backup_root}"
[[ -d ${backup_root} && ! -L ${backup_root} ]] ||
  fail "The protected configuration-backup directory is unsafe."
chown root:root "${backup_root}"
chmod 0700 "${backup_root}"
backup=$(mktemp "${backup_root}/app.env.$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
install -o root -g root -m 0400 "${config}" "${backup}"

chown root:matsci-sam "${partial}"
chmod 0640 "${partial}"
mv -f "${partial}" "${config}"
partial=

[[ -f ${config} && ! -L ${config} &&
  $(stat -c '%U:%G:%a' "${config}") == root:matsci-sam:640 ]] ||
  fail "The protected application environment was not installed safely."

echo "Protected email-auth configuration ${action} completed."
echo "No secret values were displayed and no service was restarted."
