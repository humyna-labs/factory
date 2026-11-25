# Handoff D2-W2: harden the human-run scripts, then backlog items

From: the coach. For: the factory agent in `/workspace/factory`. Version 2, written 2026-11-25 11:35 SGT.
Window: 13:30-16:00 SGT (05:30-08:00 UTC). The human is away during the window.

## 1. Goal and why
Tonight the human will run `scripts/setup-repo.sh` and `scripts/install-workflows.sh` on his Mac
as the GitHub organization owner, and then the first real task will run on `humyna-labs/resume-sg`.
An independent review (Codex, a different model from the one that wrote the scripts) found
security problems in those scripts. Fix them first. Then make the skeleton able to run, be
interrupted, resume and leave a report without a human.

## 2. Read first
- Appendix A of this file (the review findings)
- `docs/reports/2026-11-25-D2-phase1.md`, `docs/backlog.md`, `docs/design/trace-D2.md`
- `docs/principles.md`, `AGENTS.md`

## 3. Verified facts
| ID | Fact | How verified |
|---|---|---|
| F1 | Pushing to `humyna-labs/factory` as `humyna-bot` fails with 403 | Your Phase 1 push |
| F2 | The human pushes `factory/v1` from the host and opens a PR. It will NOT be merged before the evening | Coach decision |
| F3 | One live `claude -p` call parsed every flag; the result event has `permission_denials` and `safety_stops` | Your Phase 1 report |
| F4 | `/workspace/factory` is a bind mount of the human's Mac directory. A symlink created here resolves on the Mac when the human runs a script there | Container design |
| F5 | Codex cannot use its own sandbox in this container (bubblewrap cannot create namespaces). When it could not read files it used a server-side web search, which does not pass through the container firewall | Human's run, 2026-11-25 11:19 |

## 4. Requirements (in this order; skip a blocked item and record why)
| ID | Requirement | Why | Verify by |
|---|---|---|---|
| W2-01 | Branch `factory/v1.1` from `factory/v1`. Commit locally only. **Do not push**, do not open a PR. | Push permission is being fixed (F1) | `git log` |
| W2-02 | Fix review findings A1 to A5 in `scripts/install-workflows.sh`, `scripts/setup-repo.sh`, `scripts/lib/common.sh` (details in Appendix A). Treat every file produced by an agent as untrusted input to a human-run script. | These scripts run with the owner's credentials on the Mac (F4). A1 is an exfiltration path from the container to a public repo | Tests for each finding, including a symlink fixture that points outside the repo and must be refused; a mutation check per new guard |
| W2-03 | Repository-wide rule: no symlinks in any factory or product repo. Add it to `hooks/secret-guard.sh` or a new guard, to the pre-push hook, and to `ci/workflows/gates.yml`. | Same exfiltration path, closed at every layer (P-11) | Tests and a mutation check |
| W2-04 | Disable web tools for every role: deny `WebSearch` and `WebFetch` in every `settings/*.json`, and assert it in a test. Write in the backlog that the future Codex runner must disable Codex web search and must review a read-only copy, because Codex's own sandbox cannot run in this container (F5). | Server-side web tools bypass the container firewall (F5) | Unit test over all settings files |
| W2-05 | BL-05: product clones use the factory pre-push hook, fetch before creating a worktree, and clean up finished worktrees. | Needed for the first real task tonight | Tests with a local bare repo |
| W2-06 | BL-03: resume from labels after an interruption, with no duplicate PRs, issues or ledger rows. | Unattended windows end mid-task | Dry-run test that kills the run mid-stage and resumes |
| W2-07 | BL-04: the verify stage updates `feature_list.json`; all roles stay blocked from it. | Only verification may mark a feature as passing (P-06) | Unit test plus a path-guard test |
| W2-08 | BL-01 and BL-02: the `SessionStart` hook (inject `progress.md` and open escalations) and the `Stop` hook (block ending while the report is missing). Wire both into the role settings. | Make R-20 and long runs enforced by mechanism (P-02, G-04) | Hook unit tests and a mutation check. Up to 3 minimal live calls (`--model haiku`, `--max-turns 2`, total under 0.05 USD) to confirm the hooks fire |
| W2-09 | Write `docs/adr/0002-permission-model.md` (proposed), citing principle IDs. Cover: the machine account gets Write on factory and product repos to push branches and open PRs; every `main` is protected by a ruleset; the factory repo requires 1 approval from the human and `CODEOWNERS` is `* @humyna`; product repos use code-owner review on high-risk paths; default workflow token permissions are read-only; merge method per profile (factory: merge commits allowed, so per-commit `Agent-Role` trailers survive; products: squash). | F1 exposed a conflict the coach wrote; finding A3 and A5 show the ruleset needs explicit choices | File exists |
| W2-10 | Role-session reports in `/workspace/runs/reports/`: append one line per report to `/workspace/runs/reports/INDEX.md` (path, repo, issue, stage, attempt, UTC time). | The human's harvest script needs an index for files outside git | Unit test |

## 5. Constraints
- Same rules as Phase 1: no `.github/workflows/` files, no bypass flag, no secrets, minimal env for child processes, one writer at a time.
- No live GitHub calls of any kind in this window, including read-only `gh api`.
- If something is blocked, record it and move to the next item. Do not work around it.
- Time budget: start no new item after 07:30 UTC. By 07:50 UTC, commit and write the report.
  W2-02 to W2-04 matter most; the rest may be left for the next window.

## 6. Out of scope
- The Telegram command bot, the Codex runner itself, other roles, concurrency above 1.
- Any change to `docs/design/*` or Section A of `docs/principles.md`.
- Findings A6 and A7: put them in the backlog with acceptance criteria.

## 7. Human-only steps you should list in the report
- Anything that needs a GitHub write, a ruleset, a token change, a repository setting, or the Cloudflare dashboard, in the order the human should do them tonight.

## 8. Phase 0: read-back (then stop)
Write `docs/design/readback-D2-W2.md`: W2-01 to W2-10 in your own words, how you will fix each of
A1 to A5, ambiguities with your intended reading, and the files you expect to touch. Stop and wait
for "Confirmed". After "Confirmed", work through the window without waiting for input.

## 9. Stop conditions
- 80 turns, or the time budget in section 5, whichever comes first.

## 10. Final report
Write `docs/reports/2026-11-25-D2-W2.md` from `docs/templates/run-report.md` and commit it on
`factory/v1.1`. Sections 5 to 8 are mandatory. Mark every claim "verified by running" or
"written, not run". Section 9: wall-clock time and turns used. In section 7, propose any new
golden principle you think the review findings justify.

## Appendix A: independent review of the human-run scripts (Codex, 2026-11-25)

Line numbers refer to the `factory/v1` versions.

| ID | Severity | Finding | Required fix |
|---|---|---|---|
| A1 | Critical | `install-workflows.sh` copies with symlink-following (lines 35, 63, 64, 72, 75). A symlink in the source can copy a readable file from the owner's Mac into the PR, print it in the diff, and push it to a public repo. A symlink in the destination can redirect writes outside the temporary clone. | Refuse any symlink in the source and destination trees. Copy only regular files named `*.yml` or `*.yaml` directly under `ci/workflows/`, with a size limit. Resolve real paths and refuse anything outside the clone. |
| A2 | High | The live run pushes the branch without pausing (lines 48, 60, 64, 72, 75), so a workflow with a `push` trigger can run before the owner reviews it. `--source` only affects the dry run. | Show the full diff and require the owner to type `yes` before pushing. Refuse workflows that lack a top-level `permissions:` block or that grant write scopes not on an allowlist. Document that the repository's default workflow token permissions must be read-only (set by `setup-repo.sh`). |
| A3 | High | `setup-repo.sh` replaces the `factory-main` ruleset with a fixed payload (lines 80, 94, 110, 131). The factory profile has no required status checks; the product profile allows checks from a branch that is behind its base; the read-back only checks that a pull-request rule exists. | Before replacing, print the existing ruleset next to the new one and require `yes`. Factory profile: 1 required approval plus code-owner review; add required status checks once the workflows exist (a flag). Product profile: require branches to be up to date. After writing, read the ruleset back and verify every field that was set, not only that a pull-request rule exists. |
| A4 | Medium | Host and repository inputs are not validated (common.sh 43, setup-repo.sh 54, install-workflows.sh 60, 75): local Git `insteadOf` rules can redirect the push; repository names are interpolated into API paths. | Validate the repository name against `^[A-Za-z0-9._-]+$` and the owner against `humyna-labs`. Pass `--hostname github.com` to `gh`. Before pushing, check that the resolved push URL of `origin` is `https://github.com/humyna-labs/<repo>.git`. |
| A5 | Medium | Partial failure leaves remote changes in place (setup-repo.sh 60, 67, 74, 110; install-workflows.sh 75, 78). | Do all read-only lookups (team, existing ruleset, labels) first, then mutate. Make every step idempotent so a re-run converges. On failure, print which remote changes were already made. If PR creation fails after a push, say so and print the branch name. |
| A6 | Low | The timeout helper sends one `TERM` to the direct child only (common.sh 18, 20, 23). | Backlog: kill the process group, then `KILL` after a grace period. |
| A7 | Low | Temporary files in the system temp directory (setup-repo.sh 83, 84, 104; install-workflows.sh 58, 59). | Backlog: keep, but use `mktemp` with a trap, and never write tokens to temp files. |
