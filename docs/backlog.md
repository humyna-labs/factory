# Backlog

Everything in `docs/design/factory-spec.md` and brief D2 that Phase 1 did not build. Ordered for
unattended windows: items that an agent can finish alone, at low risk, come first. High-risk
items (workflows, settings, security paths) need the human's review and come later.
Size: S (under 2 h), M (one overnight window), L (several windows). Every item cites principles.

## Unattended-ready (low risk)

- [x] **BL-01 SessionStart hook injects context (R-21).** Done in D2-W2 (see docs/reports/2026-11-25-D2-W2.md). S, low. Deps: none. Principles: P-06, P-03.
  Acceptance: `hooks/session-start.sh` prints `progress.md` and the open escalations
  (`/workspace/runs/escalations/*.md`, titles only) as `additionalContext` JSON; wired in every
  `settings/<role>.json` under `SessionStart`; tests with a fake `progress.md`; mutation check for
  each rule; empty or missing files do not fail the session.
- [x] **BL-02 Stop hook blocks ending without a report (R-21).** Done in D2-W2 (see docs/reports/2026-11-25-D2-W2.md). S, low. Deps: none. Principles: P-06, G-01.
  Acceptance: `hooks/stop-report.sh` exits 2 (or prints `{"decision":"block","reason":...}`)
  when the report path for the session is missing or sections 5 to 8 are empty, reusing the same
  rules as `coordinator/src/report.ts`; respects `stop_hook_active` to avoid loops; tests for
  missing, empty and complete reports; mutation check.
- [x] **BL-03 Resume from labels after interruption (spec 3.4).** Done in D2-W2 (see docs/reports/2026-11-25-D2-W2.md). M, low. Deps: none. Principles: P-01, P-06.
  Acceptance: queue mode also picks up issues in `factory:tests..pr` states, reuses the worktree
  and the attempt count from `events.jsonl`; killing the coordinator mid-stage and re-running
  finishes the task with no duplicate PR, issue or ledger row for completed stages (test).
- [x] **BL-04 Verify stage updates `feature_list.json` (P-06).** Done in D2-W2 (see docs/reports/2026-11-25-D2-W2.md). S, low. Deps: initializer format (BL-12) or a minimal schema. Principles: P-06.
  Acceptance: after `verify` passes, the coordinator (not a role) marks the task's feature as
  passing and commits it; a Zod schema for the file; path guard keeps blocking roles (R4).
- [x] **BL-05 Product clones use the factory push hook; worktree cleanup.** Done in D2-W2 (see docs/reports/2026-11-25-D2-W2.md). S, low. Deps: none. Principles: P-05, P-12.
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

- [ ] **BL-23 Timeout helper kills the whole process group (review finding A6).** S, low. Deps: none. Principles: G-04.
  Acceptance: `with_timeout` in `scripts/lib/common.sh` starts the command in its own process
  group where bash 3.2 allows it (`set -m` in a subshell), sends `TERM` to the group, waits a grace
  period (5 s), then sends `KILL`; a test with a command that spawns a child which ignores `TERM`
  shows both are gone after the grace period; still bash 3.2 compatible (static lint).
- [ ] **BL-24 Temporary files in human scripts (review finding A7).** S, low. Deps: none. Principles: G-04.
  Acceptance: every temporary file or directory comes from `mktemp` (`-d` for directories) and is
  removed by one `EXIT` trap that also keeps `on_exit_report`; no token, header or credential is
  ever written to a temporary file (grep test over `scripts/` for `GH_TOKEN`, `Authorization`,
  `auth token` next to a redirection); a test kills the script mid-run and finds no leftover file.

## Proposed by the coach on 2026-11-25 (written only, not built)

- [ ] **BL-W1 Web access by role.** M, high. Deps: BL-12 (roles), BL-13. Principles: P-11, P-08, P-09.
  Rule: never give one role private data, untrusted web content and a way to send data out at the
  same time.
  Acceptance: (1) a read-only `researcher` role with `WebSearch` and `WebFetch`, no secrets in its
  environment, no write access except its note; its output is a sourced note
  (`/workspace/runs/research/<task>/<n>.md`, every claim with a URL and retrieval date) that other
  roles read; (2) `builder` and `qa` may use `WebFetch` only for an allowlist of documentation
  domains, as Claude Code permission rules by domain (`WebFetch(domain:...)`), and `WebSearch` stays
  denied; (3) `reviewer` and `compliance` keep no web access; (4) `coordinator/test/web-tools.test.ts`
  becomes a per-role policy table (role, allowed web rules) and fails on any rule not in the table;
  (5) a check that no role that may fetch the web also has private data or an outbound write path
  (the three-way rule above), with a test per role.
- [ ] **BL-W2 PR review brief for the human.** M, high. Deps: BL-13, BL-11. Principles: P-11, G-01, G-02.
  Acceptance: (1) a `pr-briefer` role (read-only) writes one PR comment in Chinese with: verdict;
  changes grouped by risk; evidence, each item marked "run" or "not run"; both reviewers' findings
  and where they disagree; at most three places the human must read, as links to file and line;
  (2) the coordinator posts the comment (roles never call GitHub, R-02) and updates it instead of
  adding a second one on re-runs; (3) PRs that touch a high-risk path always get a second review from
  a different model (Codex, BL-13); the coordinator decides this from the changed paths
  (`high_risk_paths`), never an agent, and a PR without the second review cannot leave `pr`;
  (4) golden cases: low risk (one reviewer), high risk (two reviewers), reviewers disagree.
- [ ] **BL-W3 Helper requests.** M, low. Deps: BL-13, BL-W1. Principles: P-07, P-09, P-11.
  Acceptance: (1) a role session may request a helper (security reviewer, second-model reviewer,
  researcher) by writing `/workspace/runs/requests/<task>/<n>.json` with the helper kind, the reason
  and a budget (USD and turns), validated by a Zod schema; (2) the coordinator approves or refuses
  by policy, never by asking an agent: helpers are read-only, work on a read-only copy of the task,
  run under a budget cap no larger than the policy maximum, and cannot request helpers; every
  decision is an event and appears in the digest; (3) in-session subagents inherit the role's
  settings and need no approval (documented in each role file); (4) tests: approved request,
  over-budget request refused, helper asking for a helper refused, write attempt by a helper blocked
  by the path guard.

## Proposed in D2-night on 2026-11-25 (written only, not built)

- [ ] **BL-25 Deploy products as Workers static assets, through a reviewed template PR.** M, high. Deps: H-03 done
  (Pages, 2026-11-25), BL-10. Principles: P-11, G-04, R-13, R-18.
  Context: Cloudflare's "Create application" now starts a Workers flow that opens autoconfig PRs
  (`docs/failures.md`, 2026-11-25). Deploy configuration is a high-risk path and must never arrive that way.
  Acceptance: (1) the product template gains one reviewed config file for static assets only (`dist` as the
  assets directory, no Worker script, SPA fallback), written in the factory and reviewed by the owner; (2) it
  reaches each product only through a template PR that the owner reviews (`CODEOWNERS` and `high_risk_paths`
  cover the file); (3) a structure test in the template fails if the config gains a Worker entry point, bindings,
  routes or any credential, and the factory's R-13 test allows exactly that file while still refusing tokens and
  API calls (ADR, because R-13 changes); (4) the CSP and security headers stay identical: a check compares the
  headers of the Pages URL and the Workers URL (`curl -sI`, run by the owner) before the switch; (5) runbook:
  close every Cloudflare autoconfig PR unmerged, switch the production domain only after (4), keep the Pages
  project until the Workers deploy has served for one week; (6) no Cloudflare credential enters the container.
- [ ] **BL-26 The coordinator, not the issue author, sets `risk:low` from the changed paths.** M, high. Deps: BL-11.
  Principles: P-11, P-01, R-02.
  Today `assessRisk` takes max(issue label, changed paths) and a missing label counts as high; a `risk:low`
  label set by whoever wrote the issue still lowers the label part.
  Acceptance: (1) a risk label from anyone other than the coordinator can only raise risk: `risk:high` from the
  owner is honoured, `risk:low` from anyone else is ignored and reported in the digest; (2) after verify, the
  coordinator computes risk from the PR's changed paths against `high_risk_paths` and sets exactly one of
  `risk:low` or `risk:high` on the issue and the PR itself, with the deciding paths in a PR comment; (3)
  `high_risk_paths` and `CODEOWNERS` are checked to list the same patterns (structure test in the template), and
  `feature_list.json` joins both (it is not in either today); (4) unit tests: author `risk:low` plus a high-risk
  path gives high; no label plus only low paths gives low and the coordinator labels it; owner `risk:high` plus
  low paths gives high; a `risk:low` added by a non-coordinator actor is ignored; (5) golden cases for each; (6) the
  label actor is read from the issue's label events (written from memory: the GitHub events API; verify on the first run).
- [ ] **BL-27 `check-bot-access`: verify the machine token before use.** S, low. Deps: none. Principles: G-01, G-02,
  G-04, R-05.
  Context: the token was "pending organization approval" for a day and every call failed with an unexplained 403
  (`docs/failures.md`). Acceptance: (1) `bin/coordinator check-access` (container, machine token, read-only) reads,
  for the factory and every product in its configuration, `repos/<owner>/<repo>`, and requires
  `permissions.push` true and `permissions.admin` false; (2) it requires a repository outside the token's list
  (for example `humyna-labs/condo-demo`) to answer 404, which proves the repository scope; (3) on a 403 or 404 for
  a listed repository it prints the likely causes in order: token pending organization approval, repository not
  granted, token expired, with the dashboard path to check; (4) no write call, ever (a unit test over the
  assembled `gh` calls); only `GH_TOKEN` reaches the child (R-05); (5) offline tests with a fake `gh` for each
  outcome; (6) the coordinator runs it before the first task of a run and stops with that message instead of
  failing mid-task; (7) the runbook's token check, step 4, points to it.
- [ ] **BL-28 Agent teams: only an L4 candidate, for read-only investigations.** M, high. Deps: BL-W3, BL-13.
  Principles: P-07, P-08, P-09, P-11.
  "L4" is the owner's level scale, which this repository does not define; read here as "not before a later
  autonomy level, with its own ADR". Acceptance: (1) an ADR that allows multi-agent teams only for read-only
  investigations (failure analysis, reviews, research) and never for writing code, so one writer per task
  stays (P-08); (2) every team member runs under the reviewer or researcher settings (path guard read-only, no
  `gh`, no push), on a read-only copy of the task, under a shared budget cap set by the coordinator; (3) the
  coordinator starts a team only by policy for a named investigation kind, never because an agent asked
  (BL-W3 rules); (4) a cost comparison on at least three golden investigations, single agent against team
  (spec 3.1 item 7: multi-agent runs cost about 15 times more), recorded before the ADR is accepted; (5) tests:
  a team member's write attempt is blocked by the path guard, a team over budget is stopped, and a team is
  refused for an implementation task.
- [ ] **BL-29 Coordinator merges set a noreply author email.** S, high. Deps: none. Principles: R-02, R-05, R-07.
  Owner, 2026-11-26 12:30 SGT: the squash merges of resume-sg #16 and #17 recorded the machine account's private
  email as the author. Acceptance: (1) `GhGitHub.merge` passes `--author-email` with the bot's noreply address
  (`<id>+humyna-bot@users.noreply.github.com`, from configuration, not hard-coded in two places); (2) a unit test
  over the assembled `gh pr merge` arguments; (3) a check after the first merge reads the merge commit's author
  email and stops the queue if it is not a noreply address. Never rewrite the history of any repository; the two
  recorded merges stay as they are.
- [ ] **BL-30 Daily scan of public repositories for non-noreply author or committer emails.** S, low. Deps: BL-18.
  Principles: P-02, R-05. Owner, 2026-11-26. Acceptance: (1) a read-only script lists, per public humyna-labs
  repository, commits whose author or committer email is not a `users.noreply.github.com` address (or GitHub's
  own `noreply@github.com` for web merges); (2) it prints counts and short SHAs only, never the addresses; (3) it
  runs daily and reports in the digest; (4) it never changes history; remediation stays a human decision.
- [ ] **BL-31 When a PR merges, check every other open factory PR and bring it up to date.** M, high. Deps: none.
  Principles: P-01, P-02. Owner, 2026-11-26 13:35 SGT; found in jd2cv-m1: resume-sg PR #18 (base-resume) went DIRTY
  when the design-system PR #22 merged, so its auto-merge could never happen; every UI issue adds keys to the same two
  i18n dictionaries, so this recurs. The queue merge wait (v1.3) only orders low-risk auto-merges. Acceptance:
  (1) after every merge it sees (its own auto-merges, and the owner's merges of high-risk PRs, found by polling), the
  coordinator lists every other open factory PR and reads its `mergeStateStatus`; (2) BEHIND, or a clean merge of
  `origin/main` into the branch: merge in the task worktree, re-run verify (and review when the merged diff touches the
  PR's files), push, keep the PR and its auto-merge; (3) DIRTY: send the task back to impl with the conflicting paths as
  the previous failure, so the builder re-applies its change on the fresh base (QA for `tests/` conflicts), then the
  normal stages and the same PR; (4) never force-push over a commit it did not make, never touch a PR that is not a
  factory branch; (5) a high-risk PR still needs the owner's approval after the update (record whether the ruleset
  dismisses stale approvals); (6) dry-run tests with a fake remote for clean, behind and conflicting cases, and one
  live check on the next conflict.

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
  W2-04 constraint: Codex's own sandbox cannot run in this container (bubblewrap cannot create
  namespaces, handoff D2-W2 F5), and when it could not read files it fell back to a server-side web
  search that does not pass through the container firewall. So the runner must (1) disable Codex
  web search explicitly in the assembled command, asserted by a unit test like
  `coordinator/test/web-tools.test.ts`, and (2) give Codex a read-only copy of the task (a fresh
  `git worktree` or archive export owned by another user, or mounted read-only), never the live
  worktree, since its sandbox will not enforce read-only here.
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
