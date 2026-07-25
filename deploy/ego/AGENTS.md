# Ego administration workspace

This user-owned workspace supports the independent public MatSci SAM runtime
at `ego.cci.drexel.edu`.

## Ownership

- GitHub `origin/dev` is the reviewed development source.
- Superego is the private development runtime and shared-test database.
- A reviewed tree promoted to `origin/main` is the public release source.
- Ego owns its public TLS, Nginx, application releases, protected
  configuration, and PostgreSQL database.
- PA90 is the control workstation for tests, release preparation, and
  deployment initiation.

Run `$manage-matsci-environments` and inspect live state before acting.

## Rules

- Keep the HTTPS maintenance configuration active until an approved public
  release, database seed, OAuth configuration, and cutover have passed.
- Never edit `/opt/matsci-sam/current` or a release directory in place.
- Never print or copy `/etc/matsci-sam/app.env`, database credentials, OAuth
  secrets, session secrets, authentication tokens, or TLS private keys.
- The initial `DATA-AUTHORITY` value is `uninitialized`. A reviewed one-time
  seed through `deploy/seed-ego-from-superego.sh` may change it to `ego`.
  After that change, never replace or refresh the Ego database from Superego.
- Run the one-time seed, first pre-cutover release, and public cutover only
  from the recorded control workstation. Do not invoke files under
  `deploy/lib/` directly.
- A public candidate must use the exact Git tree already deployed and verified
  on Superego, then promoted to `origin/main`.
- `deploy/deploy-ego-from-workstation.sh` prepares only the first release
  after the seed. It verifies the Ego-authoritative database, builds under the
  protected public environment, starts the application on loopback, and keeps
  maintenance active. Do not reuse it for a later in-place release.
- `deploy/cutover-ego-public.sh` is the separate public-edge operation. Run it
  only after the pre-cutover marker exists and the user gives separate
  approval. It backs up and validates Nginx, tests the public contract, and
  restores maintenance after an activation failure.
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

Exact commits, releases, database facts, and data-authority state are recorded
only in `docs-internal/CURRENT-DEV-STATE.md` on PA90.
