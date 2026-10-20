# How our work reaches each other (two developers)

Set up once on each PC, inside the costareen-erp folder:

    git pull origin main
    tools\autosync-install.cmd

After that:
- **Every commit goes to GitHub by itself** (a git hook). Keys, `private/`, `secrets.env` and local data are refused.
- **Every 2 minutes** your PC pulls the other developer's work from GitHub `main` (only when your folder has no
  unsaved changes; a clash is never forced - see `tools/autosync.log`).
- **A branch you push is merged into `main` by itself** when it merges cleanly - name a branch `wip/...` or `try-...`
  to keep it out of `main` (it still gets its own preview link).
- **The dev ERP** https://costareen-erp-dev.pages.dev follows `main` within ~2 minutes; the "Dev" badge (bottom-left)
  lists who changed what and when, and any branch still waiting with its preview link.

So: commit when a piece works. Uncommitted work cannot travel.
