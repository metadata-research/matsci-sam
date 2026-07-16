# Contributing

To make changes to the Matsci YAMZ repository, follow these steps to ensure they get deployed safely and properly.

1. Create a new feature branch locally by running `git checkout -b feature/[your-feature-name-here]` from the **dev** branch (run `git checkout dev && git pull` first so you're branching from the latest). 
2. Once you're done with your changes, add them to a commit and push the changes (make sure you are pushing to the feature branch you created, not the main branch). Keep in mind that since created your branch locally, you will have to create the branch on the remote by running `git push --set-upstream origin [your-feature-branch]`. Here's what will happen if you dont add the set upstream option:

```
addyire in ~/projects/matsci-yamz on feature/ci-cd λ git push
fatal: The current branch feature/ci-cd has no upstream branch.
To push the current branch and set the remote as upstream, use

    git push --set-upstream origin feature/ci-cd

To have this happen automatically for branches without a tracking
upstream, see 'push.autoSetupRemote' in 'git help config'.
```

3. After successfully pushing your changes, the next step is to create a pull request (PR) on GitHub. This can easily be done by clicking the link when pushing your new branch to remote for the first time, or by going to GitHub (MSYAMZ Repo -> Pull Request -> Create). Ensure that you are merging your feature branch into **dev** (not main — see step 5). 

```
addyire in ~/projects/matsci-yamz on feature/ci-cd λ  git push --set-upstream origin feature/ci-cd
Enumerating objects: 12, done.
Counting objects: 100% (12/12), done.
Delta compression using up to 10 threads
Compressing objects: 100% (8/8), done.
Writing objects: 100% (9/9), 17.71 KiB | 2.95 MiB/s, done.
Total 9 (delta 3), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (3/3), completed with 3 local objects.
remote:
remote: Create a pull request for 'feature/ci-cd' on GitHub by visiting:
remote:      https://github.com/metadata-research/matsci-yamz/pull/new/feature/ci-cd <== CLICK THIS
remote:
To github.com:metadata-research/matsci-yamz.git
 * [new branch]      feature/ci-cd -> feature/ci-cd
branch 'feature/ci-cd' set up to track 'origin/feature/ci-cd'.
```

4. Once the PR is created, GitHub will run a workflow to ensure the code lints, builds, and ensures the DB migrations are consistent. This action MUST run successfully before the feature branch can be merged into main. If it fails, check the logs of the action to see why, make the necessary changes, and then push any updates to the feature branch (you don't need to make a new PR).

5. Once the PR checks have passed successfully, a maintainer will merge the PR into `dev`. Merging into `dev` does **not** deploy anything.

6. Deployment to production is a separate, deliberate step: a maintainer merges `dev` into `main`, which kicks off the deploy script on the production server (the site restarts and DB migrations run, so this is batched and timed intentionally). If you need your change live urgently, say so in the PR.

