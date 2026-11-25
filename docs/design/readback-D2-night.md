# Read-back D2-night: harden v1.2 from tonight's results, then plan resume-sg

Status: not waiting for "Confirmed" (handoff section 6). Written 2026-11-25 about 11:45 UTC.
Window: until 00:30 UTC; no new item after 23:30 UTC.
Sources read completely: `docs/design/handoff-D2-night.md`, the verifier report
(`/workspace/runs/reports/verify-2026-11-25/report.md`, P1 to P9), the Codex review
(`/workspace/runs/review/codex-W2/review.md`, findings 1 to 14), `docs/reports/2026-11-25-D2-W2.md`,
`docs/runbook.md`, `docs/adr/0002-permission-model.md`, `docs/backlog.md`, `docs/design/factory-spec.md`,
and every file N2 touches (`scripts/`, `.githooks/pre-push`, `hooks/symlink-guard.sh`,
`hooks/path-guard.sh`, `ci/workflows/gates.yml` and their tests).

## 0. Facts checked before writing (verified by running)

| Fact | How checked |
|---|---|
| `origin/main` = `a4f6355`, tag `v1` points at it; it differs from `factory/v1.1` only by `.github/workflows/gates.yml` | `git fetch`, `git rev-parse`, `git diff --stat` |
| `factory/v1.2` created from `origin/main` (N1) | `git checkout -b factory/v1.2 origin/main` |
| No python3 in the image; util-linux `script` 2.38 gives a child a tty on stdin while stdout and stderr go to files | scratch run in `/tmp` |
| Today's `gates.yml` and template `ci.yml` contain no `write`, `inherit`, `pull_request_target`, `workflow_run` or `\x`/`\u` token; one line in `gates.yml` ends in `\` | `grep` |
| The verifier's G7 fixtures still exist in `/tmp/verify-W2-gap.RbNz` (folded, prt, inherit, esc, readall) | `cat -v` |
| `hooks/test/path-guard.test.ts` "fails closed on malformed input" spawns the guard without `FACTORY_GUARD_LOG`, so it writes `rule=R0` into the real `/workspace/runs/guard.log` (P9) | read the test |
| `docs/design/factory-spec.md` names resume-sg only in the repo tree ("P3"); there is no resume-sg product section | `grep` |

## 1. Requirements in my own words

- **N1** Branch `factory/v1.2` from a freshly fetched `origin/main`. Small commits, each with an
  `Agent-Role:` trailer (I use `bootstrap`, as in v1 and v1.1).
- **N2** Fix the owner-run scripts and hooks. Every fix gets a test. Every new or changed guard gets a
  mutation check that shows a test fails when the guard is disabled. The fake `gh` stores what GitHub
  stores (OrganizationAdmin `actor_id` null).
  - a. The ruleset read-back compares an OrganizationAdmin bypass by type and mode only, and accepts `actor_id` null or 1.
  - b. Before any library is sourced and before any git command runs in the checkout, the script checks
    where it was started from (physical path, not the bind mount). Dry runs get the same check. Then
    it requires branch `main` with upstream `refs/remotes/origin/main`, a clean status, and a failed
    `git status` counts as a failure.
  - c. Workflow files and `labels.txt` may hold only printable ASCII, tab and newline (byte check). The
    staged change is shown through an escaped view that ignores diff attributes. The `yes` is read only
    from a terminal (`[ -t 0 ]`); without one the script refuses. The plan shows each label's current and new value.
  - d. New G7: any `write` or `write-all` token anywhere (block scalars too) that is not an allowlisted
    `<scope>: write` line is refused; `pull_request_target`, `workflow_run` and `secrets: inherit` are refused;
    `uses:` outside `humyna-labs/` must be pinned to a 40-hex SHA. Cases: the verifier's five fixtures and Codex's.
  - e. The temporary clone has exactly one fetch URL and one push URL (`--all`); the push uses
    `refs/heads/<b>:refs/heads/<b>`; the work starts from an explicitly fetched `main`, and the preview
    compares against that commit.
  - f. pre-push and symlink-guard fail closed on any git error and always inspect the pushed tip;
    no URL with user info is printed. In `gates.yml`: `set -o pipefail`, and the symlink scan runs
    before the tools checkout.
  - g. Each label is recorded as it is applied. A mutation that times out is reported as "outcome unknown,
    check the remote". An existing install PR is found by head prefix, base `main` and author.
  - h. B7 catches the four evasions from P6. Tests never write to `/workspace/runs/guard.log`.
  - i. Docs: runbook (bundle method, bot-authored H-01 check, `~/ai-projects/<repo>-reviewed` with a
    noreply identity check, H-03 "Continue to Pages" with preset None, a token check before first use);
    ADR 0002 accepted with option (b) and tonight's evidence; three `docs/failures.md` entries.
- **N3** Run every check, the mutation tests, the dry run, validate-runs and the golden task. Then a fresh
  in-session subagent (same model family, said so) compares the diff with the handoff and my report.
- **N4** Push `factory/v1.2` through the factory pre-push hook and open a PR to `main` with a Chinese
  brief (BL-W2 format). No merge. On any push or PR error: stop, record it, no other credentials.
- **N5** Plan resume-sg with no GitHub write: `brief-v2.md`, a draft `feature_list.json`, 3 to 5 issue
  drafts in `/workspace/runs/plans/resume-sg/`. Issue 01 is low risk and visible on the live site.
- **N6** Backlog entries with acceptance criteria only: Workers static assets through a reviewed template
  PR; the coordinator sets `risk:low` from changed paths; `check-bot-access`; agent teams as an L4
  candidate for read-only investigations. BL-W1 to BL-W3 stay.
- **N7** Product clone: check out `main`, fetch, delete the local `h01-*` branches.

## 2. My reading of the ambiguous points

1. **Where the read-back is committed.** On `factory/v1.2`, so N1 (creating the branch) comes before this file.
   I also commit the handoff itself, unchanged, as D2-W2 did. It is a human-written design input.
2. **N2b "check the entry point before sourcing".** This is a few lines at the top of each script that
   resolve the script's physical path and refuse the bind mount (case-insensitive, for APFS). No source
   and no git call comes before them. It catches accidents only: an agent who edits the copy in the bind
   mount can delete the check. The real control stays the reviewed clone (runbook). The report says this.
3. **N2b for dry runs.** Same checks, including the fetch and the `main`/`origin/main` comparison.
   As a result, a dry run from the container's working copy (on a feature branch) now refuses. The tests run dry
   runs from scratch clones with a local bare `origin`.
4. **N2c "escaped view".** `git diff --cached --text --no-ext-diff --no-textconv` piped through `cat -v`,
   after the byte check. I also record `git write-tree` before the preview and refuse to push if the commit's tree differs.
5. **N2c tty tests.** The flow tests run the scripts under util-linux `script` with stdin as a pty and
   stdout and stderr in files. The shipped scripts keep no bypass. Piping `yes` no longer works (deliberate).
6. **N2d G7 is still line-based, not a YAML parser.** I close the parser gaps I know, by refusing rather
   than parsing: YAML escapes that can build a token (`\x`, `\u`, `\U`, a trailing `\` that joins lines
   in double quotes) and explicit `? key` entries. For that, the `gates.yml` curl line loses its trailing `\`.
   Comment lines are ignored for the `uses:` rule only.
7. **N2f "full range".** Besides the order and `pipefail`, the CI symlink step scans every commit reachable
   from HEAD, not only the index (Codex 8). Small and stricter. It takes effect only after the owner
   re-installs `gates.yml` and moves or adds a tag.
8. **N2g author.** "Author" means the login of the owner's `gh` session (`gh api user`). I also stop when a
   remote `install-workflows-*` branch exists without an open PR (verifier P5, second branch), and print it.
9. **Out of N2's list:** Codex 6 (bot merge boundary, factory profile bound to its repo), 11 (structured
   read-back of every rule field), 12 (re-read before PUT), most of 10 (beyond bytes, uniqueness and length),
   and BL-23 (process-group kill). I do not build these; the report lists them as open.
10. **G-08 and G-09** are proposals from the W2 report, not yet in `docs/principles.md`. I cite them as "proposed".
11. **N5 input.** The spec gives no product content for resume-sg. So `brief-v2.md` is built almost entirely
    from marked assumptions (`[A-n]`) that the owner must confirm at gate 1. Constraints: no money, no personal data
    leaving the browser, no secrets, no new dependencies (a change to `package.json` is high risk).
12. **N7.** Besides the handoff's steps I fast-forward local `main` to `origin/main` and prune stale
    remote-tracking refs (the remote branches are already deleted). Before deleting the `h01-*` branches I record their SHAs.
13. **Mutation checks for the entry scripts.** Checks that live in `setup-repo.sh` and `install-workflows.sh`
    (not in `guards.sh`) get `# CHECK <id> begin/end` markers and a new flow mutation test, in the same
    way as the guards.

## 3. Order and stop rules

N1, read-back commit, N2 a to i (one commit per sub-item where possible, each green), N3, N4, N5, N6, N7,
report. An item that is still red at its time box goes to `wip/<item>` and the report. If the push or the PR fails,
I record the exact error and continue with N5. Boundaries (handoff section 4) apply throughout.
