# Production server layout

The production host uses system-level software and a dedicated non-login
account. Nothing is installed into an administrator's home directory.

| Purpose                        | Location                                           |
| ------------------------------ | -------------------------------------------------- |
| Releases and `current` symlink | `/opt/matsci-sam`                                  |
| Runtime secrets and settings   | `/etc/matsci-sam/app.env`                          |
| Persistent application state   | `/var/lib/matsci-sam`                              |
| Service logs                   | systemd journal (`journalctl -u matsci-sam`)       |
| PostgreSQL data                | Ubuntu package default under `/var/lib/postgresql` |

## Bootstrap

Copy this `deploy` directory to the server and run:

```bash
sudo ./deploy/bootstrap-server.sh
```

The script installs Node.js 24, pnpm 10, nginx, PostgreSQL 17, and pgvector from
the official PostgreSQL Apt repository. This matches the development database's
PostgreSQL major version and provides pgvector 0.8 or newer. It creates the
`matsci-sam` operating-system account, database role, and database. PostgreSQL
accepts local Unix-socket connections only; it is not exposed through the
firewall.

The systemd service is installed but is not enabled or started because the
application release and required secrets do not exist during bootstrap.

## Rename an existing development database

The application's database and role names come from `DATABASE_URL`. After
changing a development `.env` from `matsci_yamz` to `matsci-sam`, preserve the
existing data and role by running:

```bash
sudo ./deploy/rename-database.sh
```

The helper is idempotent and refuses to create an empty replacement if the old
database does not exist. PostgreSQL's default SCRAM password verifier survives
a role rename; an older MD5 verifier must be reset because it incorporates the
old role name.

## Hostname transition

Nginx accepts both `superego.cci.drexel.edu` and `sam.cci.drexel.edu`, so the
server and database layout do not change when the production name becomes
available. The hostname-dependent settings are centralized in
`/etc/matsci-sam/app.env`:

```dotenv
NEXT_PUBLIC_SITE_URL=https://sam.cci.drexel.edu
GOOGLE_CALLBACK_URL=https://sam.cci.drexel.edu/api/auth/callback
```

`NEXT_PUBLIC_SITE_URL` is compiled into the Next.js browser bundle. Changing it
therefore requires a new build and deployment. The Google OAuth client must also
allow the new callback URL.

TLS is deliberately separate from the bootstrap. The current hostname resolves
to a private address, so use a Drexel-issued certificate or an approved DNS-01
ACME process. Do not expose authenticated production traffic over plain HTTP.

## Development deployment runner

The `dev` branch deploys to this host through a repository-level GitHub Actions
runner with only the custom `superego-dev` label. It is deliberately registered
with `--no-default-labels`; therefore the existing production workflow, which
selects `self-hosted`, cannot run on this machine.

The runner uses the dedicated `matsci-runner` account and installs under
`/opt/actions-runner-superego`. Its sudo policy permits it to act as the
unprivileged `matsci-sam` account and to restart only `matsci-sam.service`.

Generate a repository runner registration token, place it in the root-readable
file `/tmp/matsci-sam-runner-token`, and run:

```bash
sudo ./deploy/setup-dev-runner.sh
```

The setup script consumes and deletes the short-lived token file. Merging a PR
into `dev` then builds an immutable release under `/opt/matsci-sam/releases`,
runs migrations, atomically updates `/opt/matsci-sam/current`, restarts the
service, and rolls back the symlink if the health check fails.
