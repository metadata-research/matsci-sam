# Contributing

MatSci SAM uses `dev` as its integration branch.

1. Update local `dev`, then create a short-lived feature branch.

   ```bash
   git switch dev
   git pull --ff-only
   git switch -c feature/short-description
   ```

2. Make and verify the change. Run the checks that match its scope. The normal
   pre-review set is:

   ```bash
   pnpm lint
   pnpm check-types
   pnpm db:check
   pnpm build
   ```

3. Commit the intended files and push the feature branch.

   ```bash
   git push --set-upstream origin feature/short-description
   ```

4. Open a pull request from the feature branch into `dev`. GitHub must report
   the required verification job as successful before merge.

5. A maintainer merges the pull request into `dev`. The merge updates source
   control only. It does not deploy Superego or another server.

6. A maintainer deploys a reviewed `dev` commit to Superego through the
   environment runbook. Promotion to `main` and deployment to the independent
   Ego public runtime are separate decisions. The legacy workflows are
   disabled, but `main` remains blocked until their self-hosted runners and
   deployment privileges are retired and the old deployment workflow is
   removed. A public candidate must use the same Git tree already validated on
   Superego.

Never put credentials, database dumps, private environment files, or TLS keys
in a branch, pull request, issue, workflow log, or build artifact.
