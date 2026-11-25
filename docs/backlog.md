# Backlog

Everything in `docs/design/factory-spec.md` and brief D2 that Phase 1 did not build. Ordered for
unattended windows: items that an agent can finish alone, at low risk, come first. High-risk
items (workflows, settings, security paths) need the human's review and come later.
Size: S (under 2 h), M (one overnight window), L (several windows). Every item cites principles.

## Unattended-ready (low risk)

- [ ] **BL-01 SessionStart hook injects context (R-21).** S, low. Deps: none. Principles: P-06, P-03.
  Acceptance: `hooks/session-start.sh` prints `progress.md` and the open escalations
  (`/workspace/runs/escalations/*.md`, titles only) as `additionalContext` JSON; wired in every
  `settings/<role>.json` under `SessionStart`; tests with a fake `progress.md`; mutation check for
  each rule; empty or missing files do not fail the session.
- [ ] **BL-02 Stop hook blocks ending without a report (R-21).** S, low. Deps: none. Principles: P-06, G-01.
  Acceptance: `hooks/stop-report.sh` exits 2 (or prints `{"decision":"block","reason":...}`)
  when the report path for the session is missing or sections 5 to 8 are empty, reusing the same
  rules as `coordinator/src/report.ts`; respects `stop_hook_active` to avoid loops; tests for
  missing, empty and complete reports; mutation check.
- [ ] **BL-03 Resume from labels after interruption (spec 3.4).** M, low. Deps: none. Principles: P-01, P-06.
  Acceptance: queue mode also picks up issues in `factory:tests..pr` states, reuses the worktree
  and the attempt count from `events.jsonl`; killing the coordinator mid-stage and re-running
  finishes the task with no duplicate PR, issue or ledger row for completed stages (test).
- [ ] **BL-04 Verify stage updates `feature_list.json` (P-06).** S, low. Deps: initializer format (BL-12) or a minimal schema. Principles: P-06.
  Acceptance: after `verify` passes, the coordinator (not a role) marks the task's feature as
  passing and commits it; a Zod schema for the file; path guard keeps blocking roles (R4).
- [ ] **BL-05 Product clones use the factory push hook; worktree cleanup.** S, low. Deps: none. Principles: P-05, P-12.
  Acceptance: `GitWorkspace` sets `core.hooksPath` to the factory `.githooks` on the product
  clone, runs `git fetch` before `worktree add`, and removes merged or escalated worktrees;
  tests with a local bare remote.
- [ ] **BL-06 Golden eval set to about 20 cases, judged on end state (P-10).** M, low. Deps: none. Principles: P-10.
  Acceptance: 20 cases in `evals/golden/` covering each failure class (no report, out-of-scope
  write, red check, verify fail, review fail, high-risk path, blocked dependency, time budget);
  `node evals/golden/run.ts` passes; a rubric file for the later LLM judge.
- [ ] **BL-07 Runbook: pause and resume, rollback, token rotation, add a role or gate (spec 3.7).** S, low. Deps: none.
  Acceptance: each procedure is a script with `--dry-run` where possible, or numbered dashboard steps.
- [ ] **BL-08 Escalations append a draft entry to `docs/failures.md` (principles rule 3).** S, low. Deps: none.
  Acceptance: the harness-fix draft includes a ready-to-paste failures entry; test.
- [ ] **BL-09 Path-guard Bash heuristics review.** S, low. Deps: first live run. Principles: P-05, P-11.
  Acceptance: measured false blocks from `guard.log` (for example `cat tests/x` by the builder)
  are fixed or documented in the error message; every change keeps the mutation check green.
- [ ] **BL-10 CHANGELOG and semantic version release flow (spec 3.7).** S, low. Deps: v1 tag.
  Acceptance: `CHANGELOG.md`; a documented `v1.x` tag procedure for the human; products pin `@v1`.

## Needs live sessions or the human

- [ ] **BL-11 First live task on resume-sg with the claude runner.** M, high. Deps: H-01, H-02, v1 tag, H-03. Principles: P-04, P-10.
  Acceptance: one real low-risk issue goes `ready -> auto-merge` with `bin/coordinator run --task`;
  `runs.csv` rows validate; traces in `/workspace/runs/traces/`; all role reports present;
  blocked actions counted; report written per R-20.
- [ ] **BL-12 Roles: initializer, researcher, designer, gardener (spec 3.3).** L, low. Deps: BL-11. Principles: P-06, P-09, P-12.
  Acceptance: role files with the same sections as `roles/qa.md`, settings, path-guard rules and
  cases (mutation check green), stub scenarios; initializer writes `feature_list.json`,
  `progress.md`, `init.sh`, a task graph with risk labels.
- [ ] **BL-13 Codex reviewer runner (spec 3.3).** M, low. Deps: BL-11. Principles: P-08.
  Acceptance: `runner/codex.ts` in a read-only sandbox, command assembly unit-tested, selected per
  role in the front matter; reviewer role switches to it after a golden run.
- [ ] **BL-14 Telegram command bot (R-06, spec 3.9 bot B).** L, high. Deps: BL-11. Principles: P-11, G-02, G-07.
  Acceptance: separate service under `bot/`, reads exactly `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_ALLOWED_USER_ID`, `GH_TOKEN` (R-05, test); handles private chats only; acts only when
  `from.id == TELEGRAM_ALLOWED_USER_ID`; everything else is dropped silently and logged (no reply);
  a stranger test with fake updates (other user id, group chat, channel post, edited message)
  proves nothing happens; commands `/status`, `/digest`, `/approve <id>`, `/reject <id> <reason>`,
  `/pause`, `/resume`; it only sets command labels (`cmd:*`) that the coordinator reads; it can
  never merge, and `/approve` on a high-risk PR only replies with the GitHub link (high-risk
  merges happen in GitHub with 2FA).
- [ ] **BL-15 More gates: privacy e2e, licence check, asset registry, CSP header check (spec 3.4).** M, high. Deps: H-02. Principles: P-05, P-11.
  Acceptance: each gate in `ci/workflows/gates.yml` and in `ShellGates`; a failing fixture per
  gate; mutation check where the gate is ours.
- [ ] **BL-16 CI for the factory repository itself.** S, high. Deps: H-02. Principles: P-05, R-19.
  Acceptance: `ci/workflows/factory-ci.yml` runs `pnpm -r typecheck/lint/test` on PRs; the
  factory ruleset then requires it.
- [ ] **BL-17 Concurrency limit 3 and usage-based throttling (spec 3.4, 3.8).** M, low. Deps: BL-03, BL-11. Principles: P-07.
  Acceptance: at most N tasks at once across products; concurrency drops when usage nears the
  plan limit; tests with fake clocks.
- [ ] **BL-18 Daily digest and screenshot push (spec 3.5).** S, low. Deps: BL-14.
- [ ] **BL-19 `factory new-product` with repo creation, labels and CODEOWNERS (spec 3.8).** M, high. Deps: H-04 stays human; this only automates content. Principles: G-04.
- [ ] **BL-20 Gradual loosening of risk levels (spec 3.5 item 7).** M, high. Deps: 4 weeks of data. Principles: P-11.
  Acceptance: an ADR per loosened class; automatic tightening on the first failure.
- [ ] **BL-21 Verify the required status check names after the first CI run.** S, high (human). Deps: H-02.
  Acceptance: `CHECKS` in `scripts/setup-repo.sh` matches the names GitHub shows.
- [ ] **BL-22 Golden eval in claude mode.** M, low. Deps: BL-11. Acceptance: `node evals/golden/run.ts --runner claude` exists, runs on a budget cap, and is required before prompt or CLI changes.
