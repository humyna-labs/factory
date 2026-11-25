# Runbook

Human steps (H-xx) and routine checks. Every step that can be a script is one (R-08, G-04).
Steps marked "written from memory, not verified" describe dashboards the factory cannot see.

## Reviewed clone (host, before any script)

Never run `scripts/*.sh` from `~/ai-projects/agent-factory`: it is bind-mounted into the factory
container, so the agent can change any file in it, including the scripts themselves (handoff
D2-W2 E2, F4). The scripts refuse to run from there, and from any checkout that is dirty or not at its
upstream (guard G10). That catches accidents only; this separate clone is the real control.

```
git clone https://github.com/humyna-labs/factory.git ~/factory-reviewed   # outside ~/ai-projects/agent-factory
cd ~/factory-reviewed
git checkout main
git pull --ff-only
git rev-parse HEAD        # compare with the merge commit shown on the merged pull request
git status --short        # must print nothing
```

Run every script from `~/factory-reviewed`. Before each later session: `git pull --ff-only` and
compare `git rev-parse HEAD` again. The scripts print the commit they run from.

## Tonight (2026-11-25): order of human steps

ADR 0002 gives two options for the approval deadlock. An author cannot approve his own PR, and
`install-workflows.sh` opens its PR as you. Choose one option. The recommendation is (b).

Common start (both options):
1. Host, in `~/ai-projects/agent-factory`: push `factory/v1` and `factory/v1.1` (the bot gets
   403, F1). Review and merge the `factory/v1` PR with a merge commit, then open and merge
   `factory/v1.1` into `main` the same way. No ruleset exists yet, so you can merge your own PRs.
2. Make the reviewed clone (section above) at the merged `main`.
3. Check the bot's organization role: `gh api orgs/humyna-labs/memberships/humyna-bot --jq .role`
   must print `member`. If it prints `admin`, change it to member under Organization > People.

Option (b), one OrganizationAdmin bypass in pull-request mode (recommended):
4. `scripts/setup-repo.sh humyna-labs/factory --dry-run --owner-bypass`, then the same without
   `--dry-run`. Read the plan, type `yes`.
5. `scripts/install-workflows.sh humyna-labs/factory --dry-run --source .`, then
   `scripts/install-workflows.sh humyna-labs/factory`. Read the whole diff, type `yes`, then merge the PR on
   GitHub through the bypass.
6. `git pull --ff-only`, then tag the merge commit: `git tag v1 <sha> && git push origin v1`.
7. H-04 if `humyna-labs/resume-sg` does not exist yet, then
   `scripts/setup-repo.sh humyna-labs/resume-sg --owner-bypass` (dry run first).
8. `scripts/install-workflows.sh humyna-labs/resume-sg`. Wait until all five `gates / ...` checks
   are green, then merge through the bypass. Never merge through the bypass with red or pending checks.
9. H-01 verification (below), H-03 (Cloudflare Pages), then give `humyna-bot` Write on
   `humyna-labs/factory` and `humyna-labs/resume-sg` (ADR 0002, decision 1), only after the rulesets are on.

Option (a), order only:
4. `scripts/install-workflows.sh humyna-labs/factory` (dry run first), type `yes`, merge the PR.
   Tag `v1` as in (b) step 6.
5. H-04 if needed. `scripts/install-workflows.sh humyna-labs/resume-sg`, wait for green checks,
   merge.
6. Only now: `scripts/setup-repo.sh humyna-labs/factory` and
   `scripts/setup-repo.sh humyna-labs/resume-sg` (dry runs first).
7. H-01 verification, H-03, then the bot's Write access as in (b) step 9.
8. Later, for any PR you open yourself: Settings > Rules > `factory-main` > Enforcement:
   Disabled, merge, then re-run `scripts/setup-repo.sh humyna-labs/<repo>` (it turns enforcement back on and
   reads every field back). Log each time in `docs/failures.md`.

Always run a script with `--dry-run` first. Scripts refuse to run inside the container (G-07).

## H-01 Configure rulesets (host)

```
scripts/setup-repo.sh humyna-labs/<repo> --dry-run
scripts/setup-repo.sh humyna-labs/<repo>
```

It first reads everything (admin rights, merge settings, workflow token, team, existing
ruleset, labels, the bot's org role with `--owner-bypass`). Then it prints the plan, with the existing ruleset next to the new one,
and waits for you to type `yes`. Only then does it change anything. Per profile (ADR 0002):
- factory: 1 approval plus code-owner review, merge commits and squash, no auto-merge, and required checks
  only with `--require-checks "<context>,..."`.
- product: 0 approvals plus code-owner review, squash only, auto-merge on, and the five required
  checks `gates / typecheck`, `gates / lint`, `gates / unit`, `gates / e2e`, `gates / secrets`, with the
  branch up to date.

Both profiles: the default workflow token is read-only, the labels come from `scripts/labels.txt`
(validated first), and `--owner-bypass` adds the single OrganizationAdmin pull-request bypass.
It reads every field back at the end and names any field that differs. If it fails part-way, it prints
which remote changes were already made. Every step is idempotent, so re-run the same command.

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

It clones the repo and checks that `origin` really is `https://github.com/humyna-labs/<repo>.git`
after your git `insteadOf` rules. It refuses any symlink in the clone. It copies only regular `*.yml`
or `*.yaml` files (64 KiB at most) from `ci/workflows/`, and refuses any workflow without a top-level
`permissions:` block or with a write scope. It then shows the full diff and waits for you to type `yes`
before it pushes a branch and opens a PR. If an install PR is already open, it stops and prints its URL.
Your token needs the workflow scope. Agents never write
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
