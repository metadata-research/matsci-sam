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
  seed may change it to `ego`. After that change, never replace or refresh the
  Ego database from Superego.
- No public deployment wrapper exists yet. Do not deploy an application
  release, initialize data, or enable Nginx until those separate wrappers are
  reviewed. A future public candidate must first pass on Superego.
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
