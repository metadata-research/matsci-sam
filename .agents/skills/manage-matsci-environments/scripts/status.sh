#!/usr/bin/env bash
set -euo pipefail

if [[ -n ${MATSCI_REPO:-} ]]; then
    repo=${MATSCI_REPO}
elif git_root=$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null); then
    repo=${git_root}
else
    repo=/home/chris/systemada/dev/matsci-yamz
fi
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${repo}/deploy/workstations.tsv

printf '# MatSci environment status\n\n'
printf 'Collected (UTC): %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '## Development workstation\n\n'
current_hostname=$(hostname)
printf -- '- Host: `%s`\n' "${current_hostname}"
workstation_id=unregistered
snapshot_recipient=no
if [[ -f ${workstation_registry} && ! -L ${workstation_registry} ]]; then
    registry_entry=$(
        awk -F '\t' -v host="${current_hostname}" '
            /^#/ || /^[[:space:]]*$/ { next }
            NF != 3 { exit 2 }
            $1 !~ /^[a-z][a-z0-9-]*$/ { exit 2 }
            $2 !~ /^[A-Za-z0-9][A-Za-z0-9.-]*$/ { exit 2 }
            $3 != "yes" && $3 != "no" { exit 2 }
            ++seen_id[$1] > 1 || ++seen_host[$2] > 1 { exit 2 }
            $2 == host { print $0 }
        ' "${workstation_registry}"
    ) || registry_entry=
    if [[ -n ${registry_entry} && ${registry_entry} != *$'\n'* ]]; then
        IFS=$'\t' read -r workstation_id _ snapshot_recipient \
            <<<"${registry_entry}"
    fi
fi
printf -- '- Workstation ID: `%s`\n' "${workstation_id}"
printf -- '- Snapshot recipient: `%s`\n' "${snapshot_recipient}"
if [[ -d ${repo}/.git ]]; then
    branch=$(git -C "${repo}" branch --show-current)
    commit=$(git -C "${repo}" rev-parse HEAD)
    dirty_count=$(git -C "${repo}" status --porcelain | wc -l)
    upstream=$(git -C "${repo}" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
    upstream_commit=$(git -C "${repo}" rev-parse '@{upstream}' 2>/dev/null || true)
    printf -- '- Repository: `%s`\n' "${repo}"
    printf -- '- Branch: `%s`\n' "${branch:-<detached>}"
    printf -- '- Commit: `%s`\n' "${commit}"
    printf -- '- Changed paths: `%s`\n' "${dirty_count//[[:space:]]/}"
    printf -- '- Upstream: `%s`\n' "${upstream:-<none>}"
    expected_node=
    if [[ -f ${repo}/.nvmrc && ! -L ${repo}/.nvmrc ]]; then
        expected_node="v$(tr -d '[:space:]' <"${repo}/.nvmrc")"
    fi
    actual_node=$(node --version 2>/dev/null || true)
    actual_pnpm=$(pnpm --version 2>/dev/null || true)
    printf -- '- Node expected/active: `%s/%s`\n' \
        "${expected_node:-unrecorded}" "${actual_node:-unavailable}"
    printf -- '- pnpm active: `%s`\n' "${actual_pnpm:-unavailable}"
    if [[ -n ${upstream_commit} ]]; then
        if [[ ${commit} == "${upstream_commit}" ]]; then
            printf -- '- Cached upstream state: `equal`\n'
        else
            printf -- '- Cached upstream state: `different`\n'
        fi
    fi
    if [[ -f ${state_file} ]]; then
        control_workstation=$(
            sed -n 's/^Control workstation: `\([^`]*\)`$/\1/p' \
                "${state_file}"
        )
        state_authority=$(
            sed -n 's/^Superego data authority: `\([^`]*\)`$/\1/p' \
                "${state_file}"
        )
        ego_state_authority=$(
            sed -n 's/^Ego data authority: `\([^`]*\)`$/\1/p' \
                "${state_file}"
        )
        printf -- '- Recorded control workstation: `%s`\n' \
            "${control_workstation:-missing-or-ambiguous}"
        printf -- '- Superego state authority: `%s`\n' \
            "${state_authority:-missing-or-ambiguous}"
        printf -- '- Ego state authority: `%s`\n' \
            "${ego_state_authority:-missing-or-ambiguous}"
        if [[ ${workstation_id} == "${control_workstation}" ]]; then
            printf -- '- Control-workstation match: `yes`\n'
        else
            printf -- '- Control-workstation match: `no`\n'
        fi
    else
        printf -- '- Recorded control workstation: `missing`\n'
        printf -- '- Superego state authority: `missing`\n'
        printf -- '- Ego state authority: `missing`\n'
    fi

    if command -v psql >/dev/null &&
        local_facts=$(
            psql \
                --host=/var/run/postgresql \
                --port=5432 \
                --username="$(id -un)" \
                --dbname=matsci-sam \
                --no-align \
                --tuples-only \
                --field-separator=/ \
                --command='
                    SELECT
                        (SELECT count(*) FROM "users"),
                        (SELECT count(*) FROM "terms"),
                        (SELECT count(*) FROM "definitions"),
                        (SELECT count(*) FROM drizzle."__drizzle_migrations");
                ' \
                2>/dev/null
        )
    then
        printf -- '- Local database users/terms/definitions/migrations: `%s`\n' \
            "${local_facts}"
    else
        printf -- '- Local database: `unavailable`\n'
    fi
else
    printf -- '- Repository unavailable: `%s`\n' "${repo}"
fi

printf '\n## Superego\n\n'
if superego_status=$(
    ssh -o BatchMode=yes -o ConnectTimeout=8 superego '
        set -o pipefail
        printf "Host: %s\n" "$(hostname)"
        printf "Application: "
        systemctl is-active matsci-sam.service 2>/dev/null || true
        printf "Nginx: "
        systemctl is-active nginx.service 2>/dev/null || true
        printf "Release: "
        readlink -e /opt/matsci-sam/current 2>/dev/null || echo unavailable
        printf "Data marker: "
        if [[ -f /home/cr625/superego-admin/DATA-AUTHORITY ]]; then
            sed -n "1p" /home/cr625/superego-admin/DATA-AUTHORITY
        else
            echo missing
        fi
        printf "Database counts: "
        if counts=$(
            sudo -n /usr/local/sbin/matsci-sam-ops database-counts 2>/dev/null |
                paste -sd,
        ); then
            printf "%s\n" "${counts}"
        else
            echo unavailable
        fi
        printf "HTTPS: "
        curl --connect-timeout 3 --max-time 10 --silent \
            --output /dev/null --write-out "%{http_code}\n" \
            https://superego.cci.drexel.edu/ || echo unavailable
    ' 2>&1
); then
    while IFS= read -r line; do printf -- '- %s\n' "${line}"; done <<<"${superego_status}"
    remote_authority=$(
        sed -n 's/^Data marker: //p' <<<"${superego_status}"
    )
    if [[ -n ${state_authority:-} &&
        ${remote_authority} == "${state_authority}" ]]
    then
        printf -- '- Authority agreement: `yes`\n'
    else
        printf -- '- Authority agreement: `no`\n'
    fi
else
    printf -- '- Unreachable: `%s`\n' "${superego_status}"
fi

printf '\n## Ego\n\n'
if ego_status=$(
    ssh -o BatchMode=yes -o ConnectTimeout=8 ego '
        set -o pipefail
        printf "Host: %s\n" "$(hostname)"
        printf "Application: "
        systemctl is-active matsci-sam.service 2>/dev/null || true
        printf "PostgreSQL: "
        systemctl is-active postgresql.service 2>/dev/null || true
        printf "Nginx: "
        systemctl is-active nginx.service 2>/dev/null || true
        printf "Release: "
        readlink -e /opt/matsci-sam/current 2>/dev/null || echo unavailable
        printf "Data marker: "
        if [[ -f /home/cr625/ego-admin/DATA-AUTHORITY ]]; then
            sed -n "1p" /home/cr625/ego-admin/DATA-AUTHORITY
        else
            echo absent
        fi
        printf "Node: "
        node --version 2>/dev/null || echo absent
        printf "pnpm: "
        pnpm --version 2>/dev/null || echo absent
        printf "Database counts: "
        if counts=$(
            sudo -n /usr/local/sbin/matsci-sam-ops database-counts 2>/dev/null |
                paste -sd,
        ); then
            printf "%s\n" "${counts}"
        else
            echo unavailable
        fi
        printf "Application listener: "
        listeners=$(ss -ltnH "( sport = :3000 )" | awk "{print \$4}" | paste -sd,)
        printf "%s\n" "${listeners:-closed}"
        printf "Active config SHA-256: "
        sha256sum /etc/nginx/sites-available/matsci-sam-public 2>/dev/null \
            | cut -d" " -f1 || echo unavailable
        printf "Root: "
        curl --connect-timeout 3 --max-time 10 --silent \
            --output /dev/null --write-out "%{http_code}\n" \
            https://ego.cci.drexel.edu/ || echo unavailable
        printf "Ready: "
        curl --connect-timeout 3 --max-time 10 --silent \
            --output /dev/null --write-out "%{http_code}\n" \
            https://ego.cci.drexel.edu/ready || echo unavailable
        printf "Terms: "
        curl --connect-timeout 3 --max-time 10 --silent \
            --output /dev/null --write-out "%{http_code}\n" \
            https://ego.cci.drexel.edu/terms || echo unavailable
        printf "Direct index: "
        curl --connect-timeout 3 --max-time 10 --silent \
            --output /dev/null --write-out "%{http_code}\n" \
            https://ego.cci.drexel.edu/index.html || echo unavailable
    ' 2>&1
); then
    while IFS= read -r line; do printf -- '- %s\n' "${line}"; done <<<"${ego_status}"
    ego_remote_authority=$(
        sed -n 's/^Data marker: //p' <<<"${ego_status}"
    )
    if [[ -n ${ego_state_authority:-} &&
        ${ego_remote_authority} == "${ego_state_authority}" ]]
    then
        printf -- '- Authority agreement: `yes`\n'
    else
        printf -- '- Authority agreement: `no`\n'
    fi
else
    printf -- '- Unreachable: `%s`\n' "${ego_status}"
fi
