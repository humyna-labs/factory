# Trace D2: requirements to files and verification

"Verified by running" means the command was executed on 2026-11-25 in the container and passed.
"Written, not run" means the code or document exists but its real-world effect was not exercised.

| Req | Files | How verified | Status |
|---|---|---|---|
| R-01 | `coordinator/src/coordinator.ts`, `dryrun.ts`, `coordinator/fixtures/dry-run-tasks.json` | `bin/coordinator --dry-run`: 101 auto-merge, 102 needs-human, 103 escalated, 104 skipped; `coordinator/test/coordinator.test.ts` | verified by running |
| R-02 | `coordinator/src/merge.ts`, `coordinator.ts`, `github/*.ts`, `settings/*.json`, `hooks/path-guard.sh` (B1) | `structure.test.ts` (only coordinator.ts imports merge.ts; only merge.ts calls `.merge(`; runners never import github/), `units.test.ts` (merge refuses high risk and failed checks), A2 test (exactly one merge call, for the low-risk PR) | verified by running (gh adapter merge: written, not run against GitHub) |
| R-03 | `hooks/path-guard.sh`, `coordinator/src/scope.ts`, `workspace/git.ts`, `settings/*.json` | `hooks/test/path-guard.test.ts` (46 cases incl. builder to `tests/` and `feature_list.json` blocked), out-of-scope dry-run test (stage fails, worktree reset) | verified by running (as a live Claude Code hook: written, not run) |
| R-04 | `coordinator/src/runner/claude.ts`, `settings/*.json` (`disableBypassPermissionsMode`) | `claude.test.ts` command assembly for all 4 roles; `structure.test.ts` grep; one live `claude -p` call (haiku, 1 turn) parsed every flag and reported `permissionMode: auto`, `permission_denials: []`, `safety_stops: 0`; blocked counts summed into events and digest | verified by running; literal grep exempts 3 human-owned docs (see report section 7) |
| R-05 | `coordinator/src/env.ts`, `exec.ts`, `eslint.config.js` rule | `structure.test.ts` (no `process.env` outside env.ts and tests, no env dumps, no `/proc/*/environ`), `units.test.ts` (child env allowlist), ESLint rule | verified by running; bot part is backlog BL-14 |
| R-06 | `docs/backlog.md` BL-14 | Entry exists with private-chat, `from.id`, silent drop and log, stranger test, labels-only, no high-risk merge | verified by reading (backlog only) |
| R-07 | `.githooks/pre-push`, `workspace/git.ts` commit trailer | `hooks/test/pre-push.test.ts` (other owner, similar owner, other host, main, tags, missing trailer, non-ASCII, other author rejected; good push accepted); the hook run locally on this branch exits 0 (the real push was refused by GitHub, 403) | verified by running |
| R-08 | `scripts/setup-repo.sh`, `scripts/install-workflows.sh`, `scripts/lib/common.sh`, `scripts/test/shell-lint.test.ts` | `bash -n` on all 7 scripts; lint (ASCII, `${VAR}` rule, bash-4 constructs, timeouts, `--dry-run`) with its own tests; dry-runs executed; `with_timeout` tested | verified by running under bash 5.2 only; bash 3.2 compatibility checked statically, not run |
| R-09 | `coordinator/src/escalation.ts`, `coordinator.ts` | A2 test: one `escalated=true` row with harness_fix; harness-fix issue in humyna-labs/factory (fake) with context, reproduction, expected behaviour, proposed change, acceptance criteria; draft at `/workspace/runs/dry-run/escalations/resume-sg-103.md` | verified by running (fake adapter; real issue creation written, not run) |
| R-10 | `coordinator/src/runs-csv.ts` | `runs-csv.test.ts` schema test; `bin/coordinator validate-runs /workspace/runs/dry-run/runs.csv` OK | verified by running |
| R-11 | `docs/adr/0001-skeleton-first.md`, `docs/failures.md`, `docs/playbook/`, `docs/golden-principles.md` | Files exist; ADR cites P-01, P-02, P-03, P-05, P-06, P-07, P-08, P-11, G-01, G-03, G-04, G-07 and records deviations | verified by reading |
| R-12 | `coordinator/src/queue.ts`, `cli.ts` | A2 digest (done, needs human, escalated, skipped blocked, blocked actions, cost); priority order and time-budget tests | verified by running |
| R-13 | (absence) | `structure.test.ts`: no Cloudflare token, API host or wrangler outside docs; runbook H-03 uses Git integration | verified by running |
| R-14 | `docs/reports/2026-11-25-D2-phase1.md` section 4 | No firewall block occurred; the Playwright install was refused by a read-only path, reported, not worked around | verified by running |
| R-15 | this file, the report | Every row marked | verified by reading |
| R-16 | `hooks/test/mutation.test.ts` | 15 path-guard and 8 secret-guard rules disabled one at a time; every one makes a case fail (log in the report) | verified by running |
| R-17 | `docs/design/readback-D2.md`, this file | Read-back confirmed by the human with corrections; trace exists | verified by reading |
| R-18 | `ci/workflows/gates.yml`, `templates/product/ci/workflows/ci.yml`, `scripts/install-workflows.sh` | `git ls-files` shows no `.github/workflows/` file (test); install script dry-run | verified by running (workflows themselves: written, not run on GitHub) |
| R-19 | branch `factory/v1` (local, 21 commits) | Push refused: `remote: Permission to humyna-labs/factory.git denied to humyna-bot.` / `fatal: ... The requested URL returned error: 403`. No PR opened. The pre-push hook accepts the branch when run locally | blocked: push refused (see report section 4) |
| R-20 | `docs/reports/2026-11-25-D2-phase1.md`; `coordinator/src/report.ts`, `runner/roles.ts` prompt | Report exists; `coordinator.test.ts` "fails the stage when a role session leaves no report"; `units.test.ts` report checks | verified by running |
| R-21 | `docs/backlog.md` BL-01, BL-02 | Entries with acceptance criteria | verified by reading (backlog only) |

Acceptance A4 (product template): generated into `/tmp/a4/a4-demo`; `pnpm install`, `typecheck`,
`lint`, `test` (11 tests), `build`, and `e2e` (Playwright 1.65.1 with the image's Chromium 1255,
screenshot kept) all passed. Verified by running.
