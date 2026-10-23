# MatCore source installation

The preserved MatCore standard text is not included in this repository or in
the application build. Reviewed source artifacts and manifests are kept in
protected storage outside the checkout and installed into the host database.
Each installation grants one members-only community access to that source
version. Enabling workspace tools does not grant source access.

The reviewed 0.3.0 source was retrieved from
[MatCore](https://matcore.org/standard-document-content.html) on 23 October 2026.
Its artifact SHA-256 is
`c8ff435591a5535dfb7acb4d24fd810db378e84d95fbf8c6b6e19e746e876689`.
Attribution is to the MatCore working groups, *Material Core Standard
(MatCore)*, 0.3.0. A license for the website text has not been verified. Private
installation is not a statement about permission to republish the source.

The parser takes explicit input and output paths outside the repository. See
`python3 scripts/build-matcore-standard.py --help` for its arguments. It checks
the reviewed artifact hash. The installer verifies the manifest, original
artifact hash, administrator identity and private destination. It rehearses
inside a rolled-back transaction unless `--apply` is specified.

```sh
pnpm source:install-matcore \
  --manifest /protected/matcore/standard-0.3.0.json \
  --artifact /protected/matcore/standard-0.3.0.html \
  --vocabulary COMMUNITY_SLUG --actor ADMIN_ID
```

Existing release IDs, source IDs, attribution and stored baseline hashes are
immutable. Reinstalling an identical version is a no-op. A conflicting version
fails instead of changing existing drafts or provenance. Catalog browsing
creates no database rows. Missing installation produces an empty catalog.

Tests use invented text and a distinct source identity. Do not add real source
text to fixtures, screenshots, generated reports or CI artifacts. The old 2025
reference catalog retains its separate identifiers.

Follow the [deployment checklist](../../docs/technical/matcore-deployment.md)
for protected transfer, installation and preservation checks on each host.
