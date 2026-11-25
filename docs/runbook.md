# Runbook

Human steps (H-xx) and routine checks. Every step that can be a script is one (R-08, G-04).
Steps marked "written from memory, not verified" describe dashboards the factory cannot see.

## Host rules (adopted 2026-11-25)

- Never run git on the host inside `~/ai-projects/agent-factory`. It is bind-mounted into the
  factory container, so its `.git/config` and hooks are agent-writable: `git status` there can run a
  configured `core.fsmonitor` or hook as you (verifier P1, reproduced with git 2.39). `git fetch` *from*
  it in another repository ran nothing in the same test.
- Reviewed clones live at `~/ai-projects/<repo>-reviewed` (inside `~/ai-projects`, so your noreply git
  identity applies), never inside `~/ai-projects/agent-factory`.
- Commits leave the bind mount only as a bundle, checked by SHA (below).

## Reviewed clone (host, before any script)

The scripts refuse to start from the bind mount (before they load any other file or run git), and
they refuse any checkout that is not a clean `main` tracking `origin/main` at the freshly fetched
`origin/main`. Dry runs check the same. That catches accidents only: an agent can edit the copy in
the bind mount. The separate clone is the real control.

```
git clone https://github.com/humyna-labs/factory.git ~/ai-projects/factory-reviewed
cd ~/ai-projects/factory-reviewed
git config user.email     # must print your noreply address (...@users.noreply.github.com)
git checkout main
git pull --ff-only
git rev-parse HEAD        # compare with the merge commit shown on the merged pull request
git status --short        # must print nothing
```

Run every script from `~/ai-projects/factory-reviewed/scripts/`. Before each later session:
`git pull --ff-only` and compare `git rev-parse HEAD` again. The scripts print the commit they run from.
The confirmation `yes` must be typed at the terminal; piped input is refused.

## Moving commits out of the container: the bundle method

Use it whenever the machine account cannot push a branch itself, and for the first `main` of a
new product (H-04). The agent creates the bundle and reports its branch SHA.

```
# container (agent): git bundle create /workspace/runs/<name>.bundle <branch>; git rev-parse <branch>
cd ~/ai-projects/<repo>-reviewed
git fetch ~/ai-projects/agent-factory/runs/<name>.bundle <branch>:<branch>
git rev-parse <branch>    # must equal the SHA in the agent's report; stop if it differs
git push origin <branch>
```

A bundle is a data file: fetching from it runs nothing from the container.

## Machine token check (before first use, and after any change)

The fine-grained token of `humyna-bot` was "pending organization approval" from its creation until
2026-11-25, so it reached nothing (the 403 of F1). Check before the first use (dashboard labels written
from memory, not verified):

1. GitHub, Organization `humyna-labs`, Settings, Personal access tokens, Pending requests: the
   token must not be listed there. Active tokens: it must be listed.
2. Its repository access: exactly `humyna-labs/factory` and `humyna-labs/resume-sg` (add each new
   product deliberately).
3. Its permissions: Contents, Pull requests, Issues read and write; Checks, Commit statuses,
   Actions read; Metadata read. Nothing else: no Administration, no Workflows, no Secrets.
4. From the container, read-only: `gh api repos/humyna-labs/<repo> --jq .permissions.push` prints `true`
   for each granted repository, and a repository outside the list answers 404. (A
   `check-bot-access` script is backlog BL-27.)

## Done on 2026-11-25 (record)

- `factory`: PR #1 (`factory/v1`) and #2 (`factory/v1.1`) merged with merge commits; `setup-repo.sh
  humyna-labs/factory --profile factory --owner-bypass` and `install-workflows.sh`, run from a fresh
  reviewed clone; PR #3 (`gates.yml`) merged through the bypass. `main` = `a4f6355`, tagged `v1`.
- The read-back failed on one field in both repositories: GitHub stores the OrganizationAdmin
  bypass actor with `actor_id` null (`docs/failures.md`). v1.2 accepts null.
- `resume-sg`: H-04 with the bundle method, product ruleset, workflow install PR with all five
  `gates / ...` checks green on the first run (the names match), merged through the bypass. H-01
  verified with bot-authored PRs (below). H-03 done: https://resume-sg.pages.dev.
- Token approved by the organization (repositories `factory` and `resume-sg`).

## After a factory pull request that changes `ci/workflows/` is merged

1. In `~/ai-projects/factory-reviewed`: `git pull --ff-only`, compare `git rev-parse HEAD` with the merge commit.
2. `scripts/install-workflows.sh humyna-labs/factory --dry-run --source .`, then
   `scripts/install-workflows.sh humyna-labs/factory`. Read the whole escaped diff (also on GitHub), type `yes`.
3. Merge the install PR through the bypass.
4. Tag: products call `gates.yml@v1` with `factory-ref: v1`, so `v1` is a moving major tag (spec 3.7).
   Add an exact tag and move `v1` to the same commit: `git tag v1.2.0 <sha> && git tag -f v1 <sha>`,
   then `git push origin v1.2.0 && git push -f origin v1`. Until `v1` moves, products keep running the old gates.

## H-01 Configure rulesets (host)

```
scripts/setup-repo.sh humyna-labs/<repo> --dry-run [--owner-bypass]
scripts/setup-repo.sh humyna-labs/<repo> [--owner-bypass]
```

It first reads everything (admin rights, merge settings, workflow token, team, existing
ruleset, labels, the bot's org role with `--owner-bypass`). Then it prints the plan: the existing
ruleset next to the new one, and each label as NEW, SAME or CHANGE with its current and new value. It
waits for you to type `yes` at the terminal. Only then does it change anything, and it records each change
as it happens. Per profile (ADR 0002, accepted with option b):
- factory: 1 approval plus code-owner review, merge commits and squash, no auto-merge, and required checks
  only with `--require-checks "<context>,..."`.
- product: 0 approvals plus code-owner review, squash only, auto-merge on, and the five required
  checks `gates / typecheck`, `gates / lint`, `gates / unit`, `gates / e2e`, `gates / secrets`, with the
  branch up to date.

Both profiles: the default workflow token is read-only, the labels come from `scripts/labels.txt`
(validated first: printable ASCII, unique names), and `--owner-bypass` adds the single OrganizationAdmin
pull-request bypass. At the end it reads every field back (labels with color and description) and names any field
that differs. If it fails part-way, it prints which remote changes were made and which have an unknown outcome
(a call that timed out may still have reached GitHub: check the repository settings before re-running).
Every step is idempotent, so re-run the same command.

### H-01 verification (required, with bot-authored PRs)

Your own PRs can be merged through the bypass, so they prove nothing about the bot. Use PRs opened
by `humyna-bot` (as on 2026-11-25, resume-sg #2 and #3):

1. A bot branch that changes only `public/_headers` (a high-risk path) and a bot PR for it.
2. `gh pr view <n> --json reviewDecision,mergeStateStatus` shows `REVIEW_REQUIRED` and `BLOCKED`, and the
   bot's `gh pr merge <n> --squash` is refused.
3. You approve it on GitHub; it becomes mergeable. Close it without merging.
4. A bot PR that changes only `src/App.tsx` shows `CLEAN` without asking for your review. Close it.
5. Delete both branches.

If step 2 merges, use the fallback and repeat the verification:

```
scripts/setup-repo.sh humyna-labs/<repo> --review-mode required-reviewers --team <team-slug>
```

That adds GitHub's path-scoped "required reviewers" rule for the high-risk patterns. It needs
an organization team that contains you. Its JSON shape was written from memory: if the API rejects it,
configure the same rule in the ruleset UI and record what you did in `docs/failures.md`.

## H-02 Install workflow files (host)

```
scripts/install-workflows.sh humyna-labs/<repo> --dry-run --source <local checkout>
scripts/install-workflows.sh humyna-labs/<repo>
```

It checks that the repository's default workflow token is read-only, clones the repo, and checks
that `origin` has exactly one fetch URL and one push URL, both `https://github.com/humyna-labs/<repo>.git`
after your git `insteadOf` rules. It starts from the clone's `main`, not the default branch. It refuses any
symlink in the clone. It copies only regular, visible `*.yml` or `*.yaml` files (64 KiB at most, printable
ASCII, tab and newline only) from `ci/workflows/`. It refuses a workflow without a top-level
`permissions:` block, any `write` token, `pull_request_target`, `workflow_run`, `inherit`, YAML
escapes, and any `uses:` outside `humyna-labs/` that is not pinned to a full commit SHA. It shows the change
as an escaped diff against `main` (a control byte would show as `^X`) and waits for you to type `yes`. Then
it checks that the commit is exactly the reviewed tree on top of `main`, and pushes
`refs/heads/<branch>`. It stops if an install PR of yours is open, or if an install branch
exists without one. Your token needs the workflow scope. Agents never write `.github/workflows/` (R-18);
they edit `ci/workflows/` and you install after review.

## H-03 Connect a product to Cloudflare Pages (dashboard)

The container has no Cloudflare credential and never will (R-13). As done on 2026-11-25:

1. Cloudflare dashboard, Workers and Pages, Create application. This now opens a Workers flow
   (deploy command `npx wrangler deploy`, autoconfig pull requests). Do not use it, and never merge a
   Cloudflare autoconfig PR. Choose "Continue to Pages" (labelled legacy), then Connect to Git.
2. Authorize the Cloudflare GitHub app for the `humyna-labs` organization, only the product repo.
3. Production branch `main`. Framework preset: None (not VitePress).
   Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm build`.
   Output directory: `dist`. Environment variable `NODE_VERSION=22`.
4. Save and deploy. Check the headers: `curl -sI https://<project>.pages.dev` must show
   `content-security-policy` (from `public/_headers`), `x-frame-options: DENY`,
   `x-content-type-options: nosniff` and `referrer-policy: no-referrer`.
5. Preview deployments for pull requests are fine; they get their own URLs.
6. Record the project name and URL in the product's `docs/` (no account IDs, no tokens).

Moving deploys to Workers static assets is backlog BL-25 (through a reviewed template PR).

## H-04 Create a repository in the organization (host and container)

1. Host: `gh repo create humyna-labs/<name> --public --description "<one line>"` (or the GitHub UI).
2. Container (agent): `bin/coordinator new-product <name> --out /workspace/products/<name>` (code owner:
   humyna), `pnpm install` there (creates `pnpm-lock.yaml`), `git init -b main`, commit, then
   `git bundle create /workspace/runs/<name>-main.bundle main` and report `git rev-parse main`.
3. Host: `git clone ~/ai-projects/agent-factory/runs/<name>-main.bundle ~/ai-projects/<name>-reviewed`,
   `cd` there, check `git config user.email` (noreply) and that `git rev-parse main` equals the reported SHA,
   then `git remote set-url origin https://github.com/humyna-labs/<name>.git` and `git push -u origin main`.
4. Add the repository to the machine token (token check above), then H-01, H-02, H-03.

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
