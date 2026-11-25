# Runbook

Human steps (H-xx) and routine checks. Every step that can be a script is one (R-08, G-04).
Steps marked "written from memory, not verified" describe dashboards the factory cannot see.

## Order to take a product live (first time)

1. Merge the factory PR (`factory/v1`) after review (R-19).
2. H-01 on the factory: `scripts/setup-repo.sh humyna-labs/factory` (profile factory: no status checks).
3. H-02 on the factory: `scripts/install-workflows.sh humyna-labs/factory`, review and merge the PR.
4. Tag the factory: `git tag v1 <merge commit of step 3> && git push origin v1` (host, your account).
   Products call `humyna-labs/factory/.github/workflows/gates.yml@v1`.
5. H-04 if the product repo does not exist yet; generate its content (below).
6. H-01 on the product: `scripts/setup-repo.sh humyna-labs/resume-sg`, then the verification below.
7. H-02 on the product: `scripts/install-workflows.sh humyna-labs/resume-sg`, merge the PR.
8. H-03: connect the product to Cloudflare Pages.

Always run a script with `--dry-run` first. Scripts refuse to run inside the container (G-07).

## H-01 Configure rulesets (host)

```
scripts/setup-repo.sh humyna-labs/<repo> --dry-run
scripts/setup-repo.sh humyna-labs/<repo>
```

It enables auto-merge (squash only, delete merged branches), creates the labels in
`scripts/labels.txt`, and creates or updates the ruleset `factory-main` on the default branch:
no deletion, no force push, pull request required with 0 approvals plus code-owner review,
and (products only) the five required checks `gates / typecheck`, `gates / lint`, `gates / unit`,
`gates / e2e`, `gates / secrets`. It reads everything back at the end.

The check names follow the "<caller job> / <called job>" pattern; written, not verified. After
the first CI run, compare them with the PR's checks list and fix `CHECKS` in the script if they
differ.

### H-01 verification (required, because enforcement is not certain)

0 approvals plus "require code owner review" should still need the code owner for files listed
in `CODEOWNERS`. Prove it on each product:

1. On a branch, change only `public/_headers` (a high-risk path), push, open a PR.
2. Confirm the PR shows "Review required" from the code owner and the merge button is blocked
   (also try `gh pr merge <n> --squash` from the machine account: it must be refused).
3. Approve it yourself and confirm it becomes mergeable. Close it without merging.
4. Open a PR that changes only `src/App.tsx` and confirm it does not ask for your review.

If step 2 merges, use the fallback and repeat the verification:

```
scripts/setup-repo.sh humyna-labs/<repo> --review-mode required-reviewers --team <team-slug>
```

That adds GitHub's path-scoped "required reviewers" rule for the high-risk patterns. It needs
an organization team that contains you (create it under Organization, Teams). The JSON shape of
this rule was written from memory: if the API rejects it, configure the same rule in the
ruleset UI and record what you did in `docs/failures.md`.

## H-02 Install workflow files (host)

```
scripts/install-workflows.sh humyna-labs/<repo> --dry-run --source <local checkout>
scripts/install-workflows.sh humyna-labs/<repo>
```

It clones the repo, copies `ci/workflows/*.yml` to `.github/workflows/`, shows the diff, and
opens a pull request. Your token needs the workflow scope. Agents never write
`.github/workflows/` (R-18); they edit `ci/workflows/` and you install after review.

## H-03 Connect a product to Cloudflare Pages (dashboard; written from memory, not verified)

The container has no Cloudflare credential and never will (R-13).

1. Cloudflare dashboard, Workers and Pages, Create, Pages, Connect to Git.
2. Authorize the Cloudflare GitHub app for the `humyna-labs` organization, only the product repo.
3. Production branch `main`. Framework preset: none (or Vite).
   Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm build`.
   Output directory: `dist`. Environment variable `NODE_VERSION=22`.
4. Save and deploy. Open the `*.pages.dev` URL and check the response headers include the
   `Content-Security-Policy` from `public/_headers` (browser devtools, Network tab).
5. Preview deployments for pull requests are fine; they get their own URLs.
6. Record the project name and URL in the product's `docs/` (no account IDs, no tokens).

## H-04 Create a repository in the organization (host)

1. `gh repo create humyna-labs/<name> --public --description "<one line>"` (or the GitHub UI).
2. Generate the content in the container:
   `bin/coordinator new-product <name> --out /workspace/products/<name>` (code owner: humyna).
3. In that directory: `pnpm install` (creates `pnpm-lock.yaml`), `git init -b main`, commit, add
   the remote, push `main` once from the host (agents never push `main`).
4. Continue with H-01 and H-02.

## Routine checks (container)

- All factory checks: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`.
- Dry run: `bin/coordinator --dry-run --verbose`, then
  `bin/coordinator validate-runs /workspace/runs/dry-run/runs.csv`.
- Golden tasks before changing a role prompt, the coordinator or the Claude Code version:
  `node evals/golden/run.ts`.
- Check the product template: `bin/coordinator new-product demo --out /tmp/demo`, then in
  `/tmp/demo`: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`.
  The image ships Chromium build 1255 in `/ms-playwright`, which matches Playwright 1.65.1.
- Enable the push hook in each clone: `git config core.hooksPath .githooks`.

Pause and resume, rollback, token rotation and adding roles or gates are backlog items.
