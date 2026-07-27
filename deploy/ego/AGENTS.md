# Ego administration workspace

This user-owned workspace supports the independent public MatSci-SAM runtime
at `ego.cci.drexel.edu`.

## Ownership

- GitHub `origin/dev` is the reviewed development source.
- Superego is the private development runtime and shared-test database.
- A reviewed tree promoted to `origin/main` is the public release source.
- Ego owns its public TLS, Nginx, application releases, protected
  configuration, and PostgreSQL database.
- The sole control workstation recorded in `CURRENT-DEV-STATE.md` owns tests,
  release preparation, and deployment initiation.

Run `$manage-matsci-environments` and inspect live state before acting.

## Status

Ego has been the **live public site** since 2026-07-26. Its database is
seeded and independently authoritative (`DATA-AUTHORITY` records `ego`), the
application service is active and boot-enabled, and Nginx serves the
application rather than the maintenance page. The public cutover was performed
manually by the operator after two fail-closed wrapper attempts, so **no
cutover marker exists on this host** and the active site file has not been
machine-verified against reviewed source since. Confirm the effective
configuration by inspection before any edge change.

**There is no supported later-release procedure.**
`deploy/deploy-ego-from-workstation.sh` refuses unless Ego has no release and
an inactive, disabled service, and `deploy/cutover-ego-public.sh` refuses
unless the service is disabled and the installed release directory name embeds
the current `origin/main` commit — a condition the cutover's own
`systemctl enable` permanently invalidated. Until a reviewed in-place,
database-aware Ego release operation exists, do not improvise one on this
host. To restore service quickly, roll back rather than deploy forward: the
maintenance configuration is retained root-only under `/root`, and its
reviewed bytes are tracked as
`deploy/nginx/matsci-sam-public-maintenance.conf`.

## Rules

- Before any public-edge change, capture the complete effective Nginx
  configuration, keep a root-only backup, validate with `nginx -t`, reload,
  and check the public contract. Restore the retained maintenance
  configuration from that backup if any post-change check fails.
- Never edit `/opt/matsci-sam/current` or a release directory in place.
- Never print or copy `/etc/matsci-sam/app.env`, database credentials, OAuth
  secrets, session secrets, authentication tokens, or TLS private keys.
- `DATA-AUTHORITY` records `ego`. The one-time seed ran on 2026-07-25 and can
  never run again. Never replace or refresh the Ego database from Superego.
- Run any Ego operation only from the recorded control workstation. Do not
  invoke files under `deploy/lib/` directly.
- Promoted `origin/main` must exactly match reviewed `origin/dev`. Application,
  schema, migration, dependency, build, service, and runtime-configuration
  content must already be validated on Superego; only the exact reviewed
  non-runtime allowlist may differ.
- `deploy/deploy-ego-from-workstation.sh` and `deploy/cutover-ego-public.sh`
  both completed their one-time purpose and now refuse to run against this
  host, by their own preconditions. They are retained as the record of how
  this release was produced. Neither is a redeployment path.
- Keep PostgreSQL and the Next.js listener local to Ego. PostgreSQL uses the
  Unix socket, and Next.js listens only on `127.0.0.1:3000`.
- Inspect the complete effective Nginx configuration before a change. Back up
  the active site, validate with `nginx -t`, and retain maintenance mode for
  rollback.
- Ask the user to enter sudo for one reviewed command. Never request or handle
  the password.
- Keep `incoming/` temporary and remove staged files after a completed or
  cancelled operation.
- Do not create a source worktree or copied rolling-state document here.

Exact commits, releases, database facts, control-workstation identity, and
data-authority state are recorded only in
`docs-internal/CURRENT-DEV-STATE.md` on the control workstation.
