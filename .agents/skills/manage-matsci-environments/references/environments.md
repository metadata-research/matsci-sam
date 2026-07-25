# MatSci environment registry

This file records stable roles and paths. On PA90, discover volatile state
with `../scripts/status.sh` and `docs-internal/CURRENT-DEV-STATE.md`. On a
remote host, inspect live state and follow its `AGENTS.md`. Do not rely on a
copied state file.

## PA90

- Host: `CBR-PA90`
- Repository: `/home/chris/systemada/dev/matsci-yamz`
- Private documentation:
  `/mnt/d/OneDrive/Working/Matsci/docs-internal`
- Role: current control-workstation candidate, builds, tests, release
  preparation, and local preview

The repository path `docs-internal` is a symlink to the D-drive OneDrive
directory.

GitHub `origin/dev` is the reviewed source authority. The current state file,
not this registry, identifies the active control workstation.

## Area51

- Role: planned standby development and local-inference workstation

Do not invent its hostname, paths, database role, or SSH configuration. Verify
those facts during onboarding before adding it to
`deploy/workstations.tsv`.
Running an LLM does not grant source, release, or data authority.

## Superego

- SSH alias: `superego`
- Hostname: `cci-superego`
- URL: `https://superego.cci.drexel.edu`
- Administration workspace: `/home/cr625/superego-admin`
- Live pointer: `/opt/matsci-sam/current`
- Protected environment: `/etc/matsci-sam/app.env`
- Services: `matsci-sam.service` and `nginx.service`
- Expected application listener: `127.0.0.1:3000`
- Role: private development runtime

The current state file records the control workstation and Superego data
authority. The independent remote interlock is
`/home/cr625/superego-admin/DATA-AUTHORITY`; it must agree with current state.

- PA90-authoritative reset mode permits replacement through the versioned PA90
  reset wrapper.
- Shared-data mode prohibits database replacement. Reviewed source deploys
  through the in-place wrapper; complete snapshots flow from Superego to a
  replaceable workstation database through the pull wrapper.

Superego is not a source-editing workspace. Its `tasks/` and `incoming/`
directories should normally be empty.

## ws10

- Host: `ws10.cci.drexel.edu`
- Role: current private Ollama inference dependency

Exact versions, models, and availability belong in current state. An
inference host is never a data or release authority.

## Ego

- SSH alias: `ego`
- Hostname: `cci-ego`
- URL: `https://ego.cci.drexel.edu`
- Administration workspace: `/home/cr625/ego-admin`
- Live pointer: `/opt/matsci-sam/current`
- Protected environment: `/etc/matsci-sam/app.env`
- Services after initialization: `matsci-sam.service`, `postgresql.service`,
  and `nginx.service`
- Expected application listener after release: `127.0.0.1:3000`
- Role: independent public application, PostgreSQL database, TLS, Nginx, and
  maintenance mode

The Ego authority marker is
`/home/cr625/ego-admin/DATA-AUTHORITY`. It begins as `uninitialized` after
runtime provisioning and changes to `ego` after the reviewed one-time seed.
Never replace or refresh the database from Superego after that transition.

Ego does not own a source-editing workspace. Public source is a reviewed tree
validated on Superego, promoted to `origin/main`, and deployed from the control
workstation. Inspect the complete effective Nginx configuration, preserve a
known-good backup, validate with `nginx -t`, and verify the public endpoint
contract before and after a reload.

## Legacy production

`id.cci.drexel.edu` is a separate legacy production environment. Its state and
incident history are in `docs-internal/PRODUCTION-ENVIRONMENT.md` and
`docs-internal/history/DB-INVESTIGATION-2026-07-12.md`.
