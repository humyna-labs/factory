# Read-back D2-W2: harden the human-run scripts, then backlog items

Status: waiting for "Confirmed". Written 2026-11-25 about 04:10 UTC.
Sources read completely: `docs/design/handoff-D2-W2.md` (incl. Appendix A),
`docs/reports/2026-11-25-D2-phase1.md`, `docs/backlog.md`, `docs/design/trace-D2.md`,
`docs/principles.md`, `AGENTS.md`, the three scripts, `settings/*.json`, `.githooks/pre-push`,
`ci/workflows/gates.yml`, `hooks/secret-guard.sh`, and the coordinator files W2-05 to W2-10 touch.

## 0. Facts I checked before writing this (verified by running, 2026-11-25)

| Fact | How checked |
|---|---|
| No tracked symlink exists in the factory repo today | `git ls-files -s` filtered on mode 120000: empty |
| All four `settings/*.json` already deny `WebFetch` and `WebSearch`; role front matter already passes them as `disallowed_tools` | read the files |
| `git remote get-url --push origin` returns the URL after both `insteadOf` and `pushInsteadOf` rewriting (an attacker rule shows `https://evil.example/...`). `git ls-remote --get-url` ignores `pushInsteadOf`, so it is not enough | scratch repo with `-c url.<x>.insteadOf=...` |
| The container's own git config has two `insteadOf` rules (ssh to https). A "refuse any insteadOf" rule in the agents' pre-push hook would break the factory's own pushes | `git config --get-regexp url` |
| Bash 5.2 and git 2.39.5 only in the container; no bash 3.2 to run against | `bash --version`, `git --version` |
| Time now about 03:55 UTC; the window is 05:30 to 08:00 UTC | `date -u` |

## 1. Requirements in my own words

- **W2-01** Create the branch `factory/v1.1` from `factory/v1`. Commit locally only. No push and no PR.
- **W2-02** Fix A1 to A5 in the three human-run scripts. Every file an agent can write (workflow
  sources, `scripts/labels.txt`, the scripts themselves) is untrusted input to a script that the
  owner runs with owner credentials on the Mac. Each fix gets a test, including a symlink fixture that
  points outside the repo and must be refused. Each new guard also gets a mutation check.
- **W2-03** Ban symlinks in every factory and product repo, at every layer: a guard script, the
  pre-push hook, `ci/workflows/gates.yml`, and (my addition) the path guard. All with tests and a
  mutation check.
- **W2-04** No web tools for any role. The deny rules already exist; add a unit test over every
  `settings/*.json` (and over the assembled `claude` command) so they cannot silently disappear.
  Add to backlog BL-13: the Codex runner must disable Codex web search and must review a read-only
  copy, because Codex's own sandbox cannot run here (F5).
- **W2-05** (BL-05) Product clones push through the factory `pre-push` hook. Fetch before
  creating a worktree. Remove finished worktrees. Tests use a local bare repo.
- **W2-06** (BL-03) If a run is killed mid-task, the next run resumes from the issue's
  `factory:*` label. It must not create duplicate PRs, harness-fix issues or `runs.csv` rows. Proven by a
  dry-run test that SIGKILLs the coordinator mid-stage and runs it again.
- **W2-07** (BL-04) After `verify` passes, the coordinator (no role) updates `feature_list.json`.
  Every role stays blocked from that file (path-guard test for all four roles).
- **W2-08** (BL-01, BL-02) A `SessionStart` hook injects `progress.md` and the open escalations. A `Stop`
  hook blocks the session from ending while its report is missing or incomplete. Wire both into every
  role's settings. Hook unit tests, a mutation check, and at most 3 tiny live calls (haiku,
  `--max-turns 2`, total under 0.05 USD) to prove they fire.
- **W2-09** Write `docs/adr/0002-permission-model.md` (status proposed) with the choices listed in
  the handoff, citing principle IDs and recording deviations.
- **W2-10** For every role-session report in `/workspace/runs/reports/`, the coordinator appends one
  line to `/workspace/runs/reports/INDEX.md`: path, repo, issue, stage, attempt, UTC time. With a unit test.

## 2. How I will fix A1 to A5

Common approach: put the checks in a new `scripts/lib/guards.sh`. Each guard is a small function between
`# GUARD <id> begin/end` markers, so a mutation test can disable each one the same way
`hooks/test/mutation.test.ts` does today. Both scripts call these functions. The scripts stay bash 3.2 compatible and
the shell lint still applies.

**A1 (symlink-following copy).** In `install-workflows.sh`:
1. After cloning, refuse if any symlink exists anywhere in the clone outside `.git/` (`find -type l`).
   This covers the source tree (`ci/`, `ci/workflows/`) and the destination (`.github/`,
   `.github/workflows/` and every file in it).
2. Resolve real paths with `cd ... && pwd -P`. Refuse if the clone root, `ci/workflows` or
   `.github/workflows` resolves outside the resolved clone root.
3. Look at every entry directly under `ci/workflows/`. Accept only regular files whose names match
   `^[A-Za-z0-9._-]+\.ya?ml$`, at most 64 KiB each. Refuse (fail closed) if any other entry is there
   (directory, symlink, fifo, other name). It does not just skip it.
4. Copy with `cat src > dest` only after the checks, into a destination that was checked not to be a
   symlink. Re-run the symlink scan after copying and before `git add`.
5. The same checks run on `--source <dir>` in dry-run mode. F4 means a symlink in the bind mount
   resolves on the Mac.
Tests: fixture clones with (a) `ci/workflows/x.yml -> /etc/hosts` (outside the repo), (b) `ci -> /tmp/elsewhere`,
(c) `.github/workflows -> ../../outside`, (d) a non-yml file, (e) an oversized file, (f) a subdirectory.
Every one must be refused with nothing copied.

**A2 (push without pause, unchecked permissions).**
1. Show `git diff --cached --stat` and the full diff, then ask `Type yes to push branch <b> to <repo>:`.
   Anything except exactly `yes` aborts with no remote change. There is no `--yes` flag. The answer is
   read from stdin, so a test can pipe it in. A human piping `yes` is a deliberate act.
2. Check every workflow before copying. It must have a top-level `permissions:` line. It must not
   contain `write-all`. Every `<scope>: write`, in block or flow style, at top level or job level,
   must name a scope on `ALLOWED_WRITE_SCOPES`. That list is empty for now, because `gates.yml` and the product
   `ci.yml` need only `contents: read`. This is a line-based check, not a YAML parser, and it errs
   on the side of refusing. The limitation is documented in the guard.
3. The docs and the script output say that the repository's default workflow token must be
   read-only. `setup-repo.sh` sets that (A3 step list).
Tests: a workflow with no permissions block, one with `write-all`, `contents: write`,
`permissions: { id-token: write }` and job-level write. All must be refused. Answering `no`, or an
empty answer, must not push.

**A3 (blind ruleset replacement, weak read-back).** In `setup-repo.sh`:
1. Read first: fetch the existing `factory-main` ruleset (if any) and print it in full next to the new
   payload ("EXISTING" / "NEW"). Then show the whole plan and require `yes` once, before any mutation.
2. Factory profile: `required_approving_review_count: 1` plus `require_code_owner_review: true`.
   A new flag `--require-checks` adds the required status checks once workflows exist. Without the
   flag the factory gets no checks and the script says so.
3. Product profile: `strict_required_status_checks_policy: true` (branch must be up to date).
4. The default workflow token becomes read-only and cannot approve PRs
   (`PUT repos/<r>/actions/permissions/workflow`). Merge settings now differ by profile (W2-09):
   factory allows merge commits and squash, products allow squash only.
5. After writing, read the ruleset back and compare every field that was set: name, target,
   enforcement, ref condition, the set of rule types, every pull-request parameter,
   `required_reviewers` if used, the strict flag and check contexts. Also read back the repo merge settings and
   workflow permissions. The comparison uses `gh api --jq`, so the Mac needs no `jq`. Any mismatch fails
   and names the field.
Tests run with a fake `gh` on PATH (section 3, item 3). They cover profile payloads, the confirm gate, and a
read-back that returns one wrong field and must fail.
The new API endpoints and field names are written from memory and cannot be checked here (no live
GitHub calls). They are marked "written, not run".

**A4 (unvalidated inputs, redirectable push).**
1. `parse_repo`: the name must match `^[A-Za-z0-9._-]+$` and must not be `.` or `..`. The owner must be exactly
   `humyna-labs`. `--team` must match `^[A-Za-z0-9_-]+$`. Label lines from `labels.txt` are
   validated: name `^[a-z0-9:-]+$`, color `^[0-9a-f]{6}$`, description printable ASCII up to 100
   characters, nothing starting with `-`. `labels.txt` itself must be a regular file and not a symlink.
2. Every `gh` call goes through one wrapper that passes `--hostname github.com` where the command
   supports it and exports `GH_HOST=github.com` for the others.
3. Before the push, `git remote get-url origin` and `git remote get-url --push origin` must both equal
   `https://github.com/humyna-labs/<repo>.git`. Item 0 shows this catches both `insteadOf` and
   `pushInsteadOf`.
Tests: bad names (`a/b`, `..`, `x;y`, `$(id)`, a name with a space), another owner, a lookalike owner,
a malicious label line, and an `insteadOf` and a `pushInsteadOf` rule in the clone's config. All must be
refused before any push.

**A5 (partial failure).**
1. `setup-repo.sh` does all reads first: auth, admin, current repo settings, team id, existing
   ruleset id and body, current labels. Then the confirm gate, then the mutations.
2. Every mutation is idempotent: PATCH settings, PUT workflow permissions, `label create --force`,
   PUT the ruleset by id or POST it if missing. A re-run converges.
3. Each successful mutation is appended to a `DONE` list. An `EXIT` trap with a non-zero status
   prints "remote changes already made: ..." (or "none").
4. `install-workflows.sh`: if push succeeds and PR creation fails, print the branch name and the
   exact `gh pr create` command to finish by hand. A re-run first looks for an open PR from an
   `install-workflows-*` branch, then stops and prints its URL instead of pushing a second branch.
Tests: the fake `gh` fails at step N, and the output must list exactly the steps before N.

**Additional untrusted inputs I found (part of W2-02, "treat every agent file as untrusted").**
- E1: `scripts/labels.txt` is agent-writable, and its fields become `gh` arguments. It is
  validated as above. A symlink there could point at a file on the Mac, and its lines would then be
  uploaded as label text.
- E2: F4 means the human would run whatever the agent last wrote into the bind mount, not
  the reviewed version. Fix: a `require_reviewed_checkout` guard. It refuses to run if any symlink exists under
  `scripts/` or `ci/`, if the checkout has uncommitted or untracked changes, or if `HEAD` differs from
  its upstream after a fetch. It prints the commit SHA so the human can compare it with the PR. This
  catches accidents only, because an agent could edit the guard itself. The real control is a human step: run the
  scripts from a separate clone outside the bind mount (section 6).

## 3. Ambiguities and the reading I will take

1. **Start time.** If "Confirmed" arrives before 05:30 UTC, I start at once. I stop by the absolute
   times in handoff section 5: no new item after 07:30 UTC, commit and report by 07:50 UTC.
2. **Confirm prompt.** It reads stdin and accepts exactly `yes`. With no terminal and no answer it
   aborts. There is no flag to skip it.
3. **Testing real mode with no network.** I restructure each script into functions plus
   `main "$@"`, and `main` runs only when the file is executed, not sourced (`BASH_SOURCE`, works in bash 3.2).
   Tests source the script, replace `require_host`, and put a fake `gh` (records calls, serves canned
   JSON, can fail on step N) and a `git` wrapper (intercepts only `push`) on PATH. Nothing in the
   shipped scripts weakens `require_host`: no environment-variable bypass.
4. **W2-03 layers.**
   (a) New `hooks/symlink-guard.sh` with `--scan-git` (index entries with mode 120000),
   `--tree <dir>` and `--commits <range>`, with marked rules.
   (b) `.githooks/pre-push` refuses a push if any pushed commit's tree holds a symlink.
   (c) `gates.yml` gets a step in the existing `secrets` job, so no new required-check name. The step is an inline
   `git ls-files -s` check, so it does not depend on which factory ref is tagged `v1`.
   (d) Path guard: a new Bash rule blocks `ln -s` and `ln --symbolic` for every role. The check mode refuses a
   changed path that is a symlink, so the coordinator's post-session check fails the stage.
   I will not add an "any insteadOf" refusal to pre-push (fact 4).
5. **W2-04 test scope.** The test asserts both denies in every `settings/*.json` (the file list is read
   from disk, so a new role is covered automatically) and in every role's assembled `claude` command.
6. **W2-05 and the dry run.** The A2 dry run pushes to a local bare remote, and the pre-push hook
   rejects that by design (not a GitHub URL). Reading: `GitWorkspace` has a `pushHookPath` option.
   The real CLI path sets it to `<factory>/.githooks`; the dry run leaves it unset and prints that.
   A separate test sets it and shows that a push to a local bare remote is rejected with the hook's own
   message, which proves the wiring. I add no bypass to the hook. The worktree starts from
   `<remote>/<base>` after `git fetch`. Cleanup: remove the worktree (`git worktree remove --force`, then
   `prune`) on `auto-merge` and `escalated`, and keep the local branch for diagnosis. `needs-human`
   worktrees are kept, since the human may ask for changes.
7. **W2-06 design.**
   - Queue mode picks up open issues labelled `factory:tests` to `factory:pr` first, then `factory:ready`.
   - `runTask` starts from the labelled state instead of `ready`.
   - Events are the commit point. Each stage writes `stage-start`, then a `stage` event carrying the
     full ledger row, then the ledger row, then the label. On resume the coordinator reads events
     after the task's last `task-start`. A finished stage whose label was not advanced is not re-run;
     its transition is applied. A missing ledger row is appended, deduplicated by (task, stage, start).
   - The attempt count is the number of finished `impl` stage events. An interrupted stage re-runs with the
     same attempt number, after `git reset --hard` and `clean` in the reused worktree, and after deleting any
     partial report at that path. After 2 interrupted starts of the same stage and attempt, the task is
     reported as "resume loop" and skipped, so it cannot loop forever.
   - No duplicates: the PR is already find-or-open. Before creating a harness-fix issue, the coordinator
     lists open `harness-fix` issues and reuses one whose title has the task id. The escalation comment
     is guarded by an event. A merge of an already-merged PR counts as merged.
   - For the kill test, `FakeGitHub` gets optional write-through persistence to a JSON file. The dry run
     gets `--resume`, which keeps the scratch repos, the fake state and the runs dir; without it the dry
     run starts fresh as today. A stub step `hang-once` blocks until killed and writes a marker so the
     resumed run passes. The test spawns `bin/coordinator --dry-run`, waits for `stage-start` of impl,
     sends SIGKILL, runs `--resume`, then checks the end states, one PR, one harness-fix issue,
     `validate-runs`, and that no (task, stage, start) row appears twice.
8. **W2-07 mapping.** The issue names its feature with a body line `Feature: <id>`. The schema (Zod) is
   `{ features: [{ id, title, passes, verified_at? }] }` and passes extra fields through, so the future
   initializer (BL-12) can add fields. If verify passes: set `passes: true` and `verified_at`, then commit with
   `Agent-Role: coordinator`. If verify fails and the feature was passing: set it back to false. If the issue
   has no `Feature:` line, the file is missing, or the id is unknown: record an event, show it in the digest,
   and do not fail the stage.
9. **W2-08 details.** The runner adds `FACTORY_REPORT_PATH` and `FACTORY_ESCALATIONS_DIR` to the
   session's minimal env, and hooks inherit it.
   - `hooks/session-start.sh` prints `hookSpecificOutput.additionalContext` with `progress.md` from
     the worktree (capped at 8 KiB, tail kept) and the first `# ` line of each escalation draft.
     Missing files never fail the session.
   - `hooks/stop-report.sh` does nothing when `stop_hook_active` is true. Otherwise it runs
     `node coordinator/src/report-cli.ts <path>`, a thin wrapper over `checkReport`, so there is one rule set,
     and prints `{"decision":"block","reason":...}` with the problems.
   - If `FACTORY_REPORT_PATH` is unset, the Stop hook allows with a stderr note: the coordinator's
     post-session check stays the authority.
   - Live calls: 1) SessionStart (does the model see a marker from `progress.md`),
     2) Stop with a missing report (does it get blocked). At most 1 spare. Each is haiku with
     `--max-turns 2` and a budget cap.
10. **W2-09 conflict to record.**
    - A factory ruleset with 1 required approval blocks PRs that the human opens himself, because an author cannot
      approve his own PR. F2 says the human opens the `factory/v1` PR. Reading: the ADR proposes
      that factory PRs be opened by `humyna-bot` once it has Write, with the human approving. For tonight,
      the human applies the new factory ruleset only after merging `factory/v1` and `factory/v1.1`. I will not add a
      bypass actor. The ADR names it as an option for the human.
    - Write for the machine account on the factory repo deviates from spec 3.6 ("factory read-only to agents").
      The ADR records it with the mitigation (ruleset, CODEOWNERS, R-19).
11. **W2-10 format.** A markdown table. The header is written when the file is created; rows are only ever
    appended. One row per role session whose report file exists after the session (a missing report has no
    row; the stage fails as today). Dry runs index into their own runs dir. Roles already cannot
    write `INDEX.md` (path-guard R1 allows only `reports/<task>/<name>.md`). I add a test case.
12. **A6, A7** go into the backlog with acceptance criteria (out of scope).
13. **The handoff file** `docs/design/handoff-D2-W2.md` is untracked. I leave it untracked because
    `docs/design/*` is out of scope. I commit only this read-back there.

## 4. Order and time plan

W2-01, then W2-02 (A1, A4, A2, A3, A5, E1, E2), W2-03, W2-04 (target: done by about 06:45 UTC).
Then W2-10 (small), W2-05, W2-06, W2-07, W2-08, W2-09, as time allows. After every item:
`pnpm -r typecheck && pnpm -r lint && pnpm -r test`, the dry run and `validate-runs`, then a small
commit. Golden tasks (`node evals/golden/run.ts`) run before the coordinator changes are committed.

## 5. Files I expect to touch

- Scripts: `scripts/install-workflows.sh`, `scripts/setup-repo.sh`, `scripts/lib/common.sh`, new
  `scripts/lib/guards.sh`, `scripts/test/*` (new script tests, fake `gh`, fixtures, mutation test),
  `scripts/labels.txt` (unchanged content, validated).
- Hooks: new `hooks/symlink-guard.sh`, `hooks/session-start.sh`, `hooks/stop-report.sh`;
  `hooks/path-guard.sh` (symlink rules); `.githooks/pre-push`; `hooks/test/*`.
- CI: `ci/workflows/gates.yml` (one step in `secrets`).
- Settings: `settings/*.json` (SessionStart and Stop hooks; web denies already present).
- Coordinator: `coordinator.ts`, `queue.ts`, `workspace/git.ts`, `report.ts` (+ `report-cli.ts`),
  `runner/claude.ts`, `github/fake.ts`, `dryrun.ts`, `cli.ts`, `events.ts`, new `features.ts`
  (feature list schema), `runner/stub.ts`, `coordinator/test/*`.
- Docs: `docs/adr/0002-permission-model.md`, `docs/backlog.md` (A6, A7, BL-13 note, done items),
  `docs/runbook.md` (H-01/H-02 changes, run scripts from a separate clone), `docs/failures.md`,
  `docs/playbook/` (one note), `docs/reports/2026-11-25-D2-W2.md`, and this file.
- Not touched: `.github/workflows/`, `docs/design/*` other than this file, Section A of
  `docs/principles.md`.

## 6. Human-only steps I already expect for tonight (the report will give the final order)

1. Push `factory/v1` and `factory/v1.1` from the host (the bot gets 403, F1). Review them.
2. Run the scripts from a fresh clone outside the bind mount, at the reviewed commit. Never run them from
   `/workspace/factory` on the Mac (E2, F4).
3. Repository settings, rulesets and workflow token permissions through `setup-repo.sh`. Then
   `install-workflows.sh`. Then the `v1` tag. Then the H-01 verification PR.

## 7. Questions (my default applies if you say only "Confirmed")

1. E2: should the scripts refuse to run unless `HEAD` equals its upstream and the tree is clean?
   Default: yes.
2. Item 10: no ruleset bypass actor for the factory; apply the factory ruleset after the two PRs are merged.
   Default: yes.
3. Item 6: keep `needs-human` worktrees until a later cleanup item. Default: yes.
