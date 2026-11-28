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
- [ ] **BL-07 Runbook: pause and resume, rollback, token rotation, add a role or gate (spec 3.7).** S, low. Source: FL-13, partly; see BL-49 (review after resume-sg). Deps: none.
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
- [ ] **BL-29 Coordinator merges set a noreply author email.** S, high. Source: FL-11 (review after resume-sg). Deps: none. Principles: R-02, R-05, R-07.
  Owner, 2026-11-26 12:30 SGT: the squash merges of resume-sg #16 and #17 recorded the machine account's private
  email as the author. Acceptance: (1) `GhGitHub.merge` passes `--author-email` with the bot's noreply address
  (`<id>+humyna-bot@users.noreply.github.com`, from configuration, not hard-coded in two places); (2) a unit test
  over the assembled `gh pr merge` arguments; (3) a check after the first merge reads the merge commit's author
  email and stops the queue if it is not a noreply address. Never rewrite the history of any repository; the two
  recorded merges stay as they are.
- [ ] **BL-30 Daily scan of public repositories for non-noreply author or committer emails.** S, low. Source: FL-11 (review after resume-sg). Deps: BL-18.
  Principles: P-02, R-05. Owner, 2026-11-26. Acceptance: (1) a read-only script lists, per public humyna-labs
  repository, commits whose author or committer email is not a `users.noreply.github.com` address (or GitHub's
  own `noreply@github.com` for web merges); (2) it prints counts and short SHAs only, never the addresses; (3) it
  runs daily and reports in the digest; (4) it never changes history; remediation stays a human decision.
- [ ] **BL-31 When a PR merges, check every other open factory PR and bring it up to date.** M, high. Source: FL-03, FL-26 (review after resume-sg). URGENT (owner,
  2026-11-26 14:45 SGT: the owner had to press Update branch by hand on #18 and #26). Deps: none.
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
- [ ] **BL-32 pre-push: trust only remote-tracking refs refreshed just before the push.** S, high. Deps: none.
  Principles: R-07, P-02. Owner, 2026-11-26 14:10 SGT, on `da0bbf0`: the hook's range (`--not --remotes`, for new
  branches and now for updates) trusts every local remote-tracking ref, and an agent can write `refs/remotes/...`
  locally to hide its commits from the checks. Acceptance: (1) the coordinator fetches `origin` right before every push
  and the hook limits `--not` to `refs/remotes/origin/*` (not `--remotes`, not other remotes); (2) the hook refuses when
  a remote-tracking ref it relies on is newer than the last fetch the coordinator recorded, or differs from
  `git ls-remote` for that ref (pick one, with an ADR note on cost); (3) tests: a forged `refs/remotes/origin/x`
  pointing at an agent commit no longer hides it; a fetched main with GitHub-made merges still passes;
  (4) GitHub's ruleset stays the hard control for `main` (R-07).
- [ ] **BL-33 gates.yml: gitleaks scans the PR's own range plus main, not every branch.** S, high (CI, the owner
  installs). Source: FL-10 (review after resume-sg). Deps: none. Principles: P-02, R-18. Owner, 2026-11-26 14:45 SGT: the "gitleaks (full history)" step scans
  `--all` branches, so a false positive on one branch (generic-api-key on the i18n key `disclaimer.5.body` after
  "Your API key.", resume-sg PR #26) failed every open PR (#18 too). Acceptance: (1) the step scans
  `origin/main..HEAD` of the PR plus the history of `main` (`--log-opts`), nothing from other branches; (2) a fixture
  repo with a finding on an unrelated branch passes, a finding in the PR range fails, a finding on main fails;
  (3) step and job names unchanged (required checks); (4) installed through `install-workflows.sh` and the `v1` tag.
- [ ] **BL-34 `.gitleaks.toml` and `.gitleaksignore` are high-risk paths.** S, high. Source: FL-10 (review after resume-sg). Deps: none. Principles: R-03,
  P-11. Owner, 2026-11-26: add `/.gitleaks.toml` and `/.gitleaksignore` to `high_risk_paths` in the product template's
  `.factory/factory.yaml` and to its `CODEOWNERS`, and to resume-sg through a reviewed PR; path-guard R3 refuses both
  for every role. Acceptance: a structure test keeps factory.yaml and CODEOWNERS in sync for these paths; a guard case
  per role; `assessRisk` marks a PR touching either as high.
- [ ] **BL-35 secret-guard flags new gitleaks allow comments and allowlist changes for the owner.** S, high. Deps:
  BL-34. Principles: P-05, R-16. Owner, 2026-11-26. Acceptance: (1) a new rule (S9) in `hooks/secret-guard.sh` reports
  any added `gitleaks:allow` comment and any change to `[allowlist]`/`[[allowlists]]` or a `.gitleaksignore` line, in
  hook mode and `--scan-git`; (2) the coordinator turns such a finding into risk:high with the reason "secret-scan
  allowlist change" (the PR waits for the owner) instead of failing verify; (3) cases and a mutation check.
- [ ] **BL-36 QA test defects: let QA test against the builder's attempt, and allow two rewrites.** M, high. Source: FL-19 (review after resume-sg).
  Owner, 2026-11-27 07:50 SGT: proposal (2) approved and built in b3a59f5 (`MAX_TEST_REWRITES` 2); proposal (1)
  (BL-36a, the builder's `src/` diff for QA) stays rejected; proposal (3) stays open. From the same decision, every
  issue the operator opens or restarts carries an "Existing tests affected:" line naming current tests that assert
  behaviour the issue changes (automation: BL-54). Deps:
  none. Principles: P-02, P-06, P-08. Not adopted on 2026-11-26 16:12 SGT; the owner keeps it for the factory review
  after resume-sg. Evidence (jd2cv-m1): resume-sg #4, #25 and #13 escalated on defective QA tests (non-unique
  queries, `innerText` under `text-transform: uppercase`, an assertion the spec contradicts); one QA rewrite was not
  enough twice, partly because only the first Test-defect line reached QA (fixed in `71ab18c`). Proposals: (1) when the
  builder ends with Test-defect, keep its `src/` diff as a patch outside the branch, apply it in a scratch copy for the
  QA re-run so QA can run its tests against a real implementation, and drop it before QA commits; (2)
  `MAX_TEST_REWRITES` 2, still counted per task; (3) the QA prompt rule: never select a control by position or as the
  only one of its role in a landmark; use its accessible name inside the feature's own region. Acceptance: dry-run tests
  for each, a mutation per behaviour, and the golden task.
- [ ] **BL-37 A review finding about missing tests goes to QA, not to the builder.** S, high. Source: FL-20 (review after resume-sg). Deps: none.
  Principles: P-02, P-06, P-08. Found in jd2cv-m1 (resume-sg#8, 2026-11-26 16:28 SGT): the code converged, but the
  reviewer failed three reviews on missing unit tests for one criterion; a review failure always goes back to impl, and
  the builder may not write tests, so the task escalated. Acceptance: (1) the reviewer may end with
  `Test-gap: <criterion> <what is untested>` lines; (2) the coordinator then sends the task to the tests stage (QA adds
  the tests, red check against the current code allows already-passing new tests only for a Test-gap), then impl and the
  normal stages, counted with BL-36's rewrite budget; (3) a stub-runner flow test and a mutation check.

## From the coach's factory lessons and the D3 run, 2026-11-26 (written only, not built; review after resume-sg)

Input: `/workspace/runs/plans/factory-review/factory-lessons-resume-sg.md` (coach; FL-01 to FL-14 read on 2026-11-26 23:55 SGT,
FL-15 to FL-28 on 2026-11-27 00:15 SGT after the coach replaced the file). FL-15 (71ab18c) and the verdict part of FL-27
(2982a5f) are already fixed and need no BL item. Existing items that cover an FL item carry "Source: FL-xx" above. BL-50 to
BL-52 come from the D3 escalations (`docs/failures.md`, 2026-11-26).

- [ ] **BL-38 Duty officer: tiered authority so the owner decides in two short batches a day.** L, high. Deps: BL-41,
  BL-14. Principles: P-11, G-02, G-07. Source: FL-01 (P0), FL-18 (the run-SHA approval joins the batch windows). Review after resume-sg. The coach's draft: T0 automatic
  (low-risk merge with green CI, Update branch, retries), T1 a read-only proxy plus an independent second review
  decides clarifications the spec already answers and medium-risk PRs (path allowlist, no new dependency, no network or
  storage change, tests present), T2 the owner approves in batches (high-risk PRs, scope changes), T3 only the owner
  (secrets, installs, rulesets, guardrail files, deletion, release). Acceptance: (1) an ADR with the tiers and the threat
  model (prompt injection through untrusted issue, JD or resume text is the main risk); (2) the decision policy is a
  file under CODEOWNERS that the proxy cannot change; (3) the proxy is read-only, without network, and only comments;
  the coordinator executes; (4) T1 merges need agreement of the reviewer, the proxy and a second model family;
  (5) metrics in the digest: owner interruptions per day, owner minutes, queue time idle waiting for the owner, proxy
  decisions overturned.
- [ ] **BL-39 Schedule by the dependency graph; never idle while a high-risk PR waits.** M, low. Deps: none.
  Principles: P-01, P-07. Source: FL-02 (P0), FL-17. Review after resume-sg. On 2026-11-26 the operator did this by hand
  (owner's 20:30 SGT rule). Acceptance: (1) the queue loops until its time budget, re-reading issues after each task;
  (2) it sets `factory:ready` itself on an issue whose `Depends-on` issues are all closed by a merged PR (the only label
  move it adds); (3) a needs-human PR never blocks tasks that do not depend on it; (4) the merge wait applies only to
  tasks that depend on the waiting PR; (5) stub-runner tests with a fake GitHub for a chain, a fork and a high-risk wait.
- [ ] **BL-40 Inbox for owner-signed requirement packs.** M, high. Deps: none. Principles: G-02, P-11. Source: FL-04
  item 1 (P1). Review after resume-sg. Acceptance: (1) the operator reads `runs/inbox/` and accepts a pack only when its
  first line is an owner signature line whose format is fixed in an ADR (with how it is verified, since a file in the
  container can be written by any process); (2) accepted packs move to `runs/inbox/accepted/` with a log line; others
  are reported, never acted on; (3) tests for a signed, an unsigned and a tampered pack.
- [ ] **BL-41 Public status file with an issue summary, for the coach.** S, low. Deps: none. Principles: P-06, R-05.
  Source: FL-04 item 2, FL-05 (P1, P2), FL-25 (status part; see BL-59). Review after resume-sg. Acceptance: (1) after every stage the coordinator
  writes `status.json` (task, stage, attempt, outcome, PR link, open issues with their factory labels, cost) to a public
  location the coach reads with git; (2) no private data: no email addresses, no tokens, no report text, checked by
  secret-guard and a test; (3) no new credential for the coach.
- [ ] **BL-42 Design gate before user-visible issues are split.** M, low. Deps: BL-12 (designer role) or the operator.
  Principles: P-12, G-04. Source: FL-06 (P0). Review after resume-sg. Acceptance: (1) a planning checklist: every
  user-visible flow has a flow diagram and desktop and phone designs approved by the owner before issues are drafted;
  (2) every UI issue names the approved design file it implements; (3) a draft check refuses a UI issue without one.
- [ ] **BL-43 Data model checked against light, medium and heavy samples.** S, low. Deps: none. Principles: P-12,
  G-01. Source: FL-07 (P0). Review after resume-sg. Acceptance: (1) the planning template asks for three realistic
  samples before the data model is fixed; (2) the heavy sample (several roles at one employer, projects, awards, open
  source) becomes a fixture and an acceptance test in the first model issue.
- [ ] **BL-44 Design spec template: an "information hierarchy" section.** S, low. Deps: BL-42. Principles: P-12.
  Source: FL-08 (P1). Review after resume-sg. Acceptance: the template fixes size, weight and colour per level
  (employer, role, project, bullet), and every design is rendered with the heavy sample of BL-43.
- [ ] **BL-45 One living spec per product, with version and revision log.** S, low. Deps: none. Principles: P-03,
  P-06. Source: FL-09 (P1). Review after resume-sg. Acceptance: (1) one spec file per product with a version line and a
  revision log, attachments in the same folder; (2) issue drafts cite the spec version; (3) the operator refuses a
  draft that cites an older version.
- [ ] **BL-46 Product template ships `.gitleaks.toml`.** S, high. Deps: BL-34. Principles: P-05, R-16. Source: FL-10
  (P1; the CI range is BL-33, CODEOWNERS is BL-34). Review after resume-sg. Acceptance: `templates/product/` contains
  the default rules plus the allowlist for dotted lowercase identifiers with 3+ parts (as resume-sg#27); a fixture with
  `disclaimer.5.body` after "API key" passes, a real-looking key still fails.
- [ ] **BL-47 Every commit in a PR has a noreply author email; account check in setup.** S, high (CI). Deps: none.
  Principles: R-05, R-07. Source: FL-11 (P1; merges are BL-29, the daily scan BL-30). Review after resume-sg.
  Acceptance: (1) a CI step fails when a commit in the PR range has an author or committer email that is not a
  `users.noreply.github.com` address, printing short SHAs only; (2) the H-01 checklist asks the owner to turn on email
  privacy for both accounts; (3) a fixture test.
- [ ] **BL-48 Runbook H-03 screenshots for Cloudflare Pages.** S, low (owner takes the screenshots). Deps: none.
  Principles: G-04. Source: FL-12 (P2). Review after resume-sg. H-03 already says "Continue to Pages", preset None.
  Acceptance: screenshots of the two choices in `docs/runbook-assets/`, linked from H-03.
- [ ] **BL-49 `bin/coordinator status` and a cancel playbook.** S, low. Deps: none. Principles: P-06, G-02.
  Source: FL-13 (P1). Review after resume-sg. Acceptance: (1) `status` prints the running task, stage and attempt, the
  PID and since when, whether stopping now is safe (between stages, or a role session that the next run repeats), and
  the exact resume command; read-only; (2) `docs/playbook/after-a-cancel.md`: read labels and the last events.jsonl
  lines, never re-open an issue or PR, resume from the labels (the #4 recovery of 2026-11-26 as the example).
- [ ] **BL-50 Stop every process left in a worktree after each role session and gate run.** S, low. Deps: BL-23.
  Principles: P-05, G-01. From D3 (`docs/failures.md`, resume-sg#11, 2026-11-26 23:05 SGT). Review after resume-sg.
  Playwright's web server runs in its own process session, so killing the role's process group is not enough.
  Acceptance: (1) after every role session and every gate run the coordinator stops each process whose working
  directory or command line is inside that task's worktree (TERM, then KILL after 5 s), and logs what it stopped;
  (2) before the e2e gate it checks that the preview port is free and fails with a clear reason if not; (3) a test with
  a fake process list and one real child process started with `setsid`.
- [ ] **BL-51 Check an issue's paths against the role write rules when it is drafted.** S, low. Deps: none.
  Principles: P-05, G-04. From D3 (resume-sg#42). Review after resume-sg. Acceptance: (1) a `bin/coordinator
  check-issue <file>` reads the Paths section and the Grants line and reports every path the builder or QA cannot
  write under path-guard (same rule table, no copy); (2) the operator runs it before opening an issue; (3) cases for
  `index.html`, `public/x.svg`, a granted path and an ordinary `src/` path.
- [ ] **BL-52 Turn budget for large issues, or split them.** S, low. Deps: none. Principles: P-07, P-12. From D3
  (resume-sg#41: QA ended at 40 turns before writing tests). Review after resume-sg. Acceptance: (1) a size estimate
  per issue (criteria count, reference size) in the draft check of BL-51; above a threshold the draft must be split or
  carry a `Budget:` line that raises max turns for that task only, within a cap in `factory.yaml`; (2) the runner
  applies it and records it in runs.csv; (3) tests.
- [ ] **BL-53 Session opening routine for operator sessions.** S, low. Deps: none. Principles: P-03, P-06.
  Source: FL-14 (P2). Review after resume-sg. Acceptance: the runbook's session start is: clear context, one
  self-contained message, then "check GitHub (issues, PRs, labels) and runs/events.jsonl first; never redo work that is
  already there".

- [ ] **BL-54 A later spec names the earlier rules and tests it replaces.** S, low. Deps: BL-45. Principles: P-03,
  G-04. Source: FL-16, FL-17 (P0). Review after resume-sg. Evidence: #13 (Certificates and Languages), #42 (an older
  e2e test expected the zh sub-label the new issue removes). Acceptance: (1) spec rules carry numbers, and a later
  spec says "replaces <spec> rule N"; (2) when an issue changes behaviour an earlier issue tested, the draft lists the
  affected existing tests and says which spec wins, as a "Tests must change:" line; (3) the draft check of BL-51 greps
  the tests for the strings and selectors the issue removes or renames and lists the hits.
- [ ] **BL-55 Screenshots reach the PR.** S, high (CI). Deps: none. Principles: G-01, P-11. Source: FL-21 (P1).
  Review after resume-sg. Evidence: the #33 comparison screenshots stayed in the worktree's `test-results/`.
  Acceptance: (1) the e2e job uploads `test-results/**/*.png` as a workflow artifact; (2) the coordinator links the
  artifact in the PR body; (3) a visual high-risk PR without screenshots fails the pr stage with a clear reason.
- [ ] **BL-56 Spec template: a principle-to-check table for every direction.** S, low. Deps: BL-45. Principles:
  P-12, G-01. Source: FL-22 (P0). Review after resume-sg. Evidence: v5.2 section 4 did not check skills, project tech,
  languages or contact details. Acceptance: the template has a table mapping each core product principle (add nothing,
  lose nothing, translation) to at least one testable check, with a column each for same language, zh to en and en to
  zh; the planning checklist refuses a spec with an empty cell.
- [ ] **BL-57 Every spec rule carries a worked example per direction.** S, low. Deps: BL-56. Principles: G-01, G-04.
  Source: FL-23 (P0). Review after resume-sg. Evidence: the 17:20 cross-language rule failed on zh to en, the main use
  case (#36, fixed by #38). Acceptance: each rule has one hand-worked example per direction, walked through by the coach
  or a reviewer before issues are split; the issue quotes the examples, and QA turns each into a test.
- [ ] **BL-58 QA and the reviewer flag a spec that defeats the product goal.** S, high (role prompts). Deps: none.
  Principles: G-04, G-05, P-02. Source: FL-24 (P0). Review after resume-sg. Evidence: the #36 fixture kept company and
  title in Chinese in an English resume so that the tests would pass. Acceptance: (1) `roles/qa.md` and
  `roles/reviewer.md` add: when a direct consequence of the spec contradicts the product goal of the brief, end with
  `Spec-conflict: <rule> <consequence>`; (2) the coordinator escalates such a task with that line as the reason
  (no rewrite budget used); (3) golden task with a planted conflict.
- [ ] **BL-59 A brief progress table: requirement, issue, status, where to see it.** S, low. Deps: BL-41. Principles:
  P-06, G-02. Source: FL-25 (P1). Review after resume-sg. Evidence: at 19:51 the owner looked for the approved new flow
  on the site while tailor-flow had not started. Acceptance: (1) every brief gets a table of its items with issue, status
  and the page or route where a merged item can be seen; (2) the coordinator updates the status column in
  `status.json` (BL-41); (3) the coach states, with each approval, when the change will be visible.
- [ ] **BL-60 Headless roles may not start background subagents or monitors.** S, high (role settings). Deps: none.
  Principles: P-01, G-01. Source: FL-27 (P1; the verdict bug itself is fixed in 2982a5f). Review after resume-sg.
  Acceptance: (1) the role front matter adds the subagent and monitor tools to `disallowed_tools` by default, with an
  explicit per-role opt-in; (2) the role prompts say: wait for every background task before the verdict; (3) a unit
  test over the assembled flags and the golden task.
- [ ] **BL-61 Run days close out like build days.** S, low (process). Deps: none. Principles: P-02, P-06. Source:
  FL-28 (P0). Review after resume-sg. Evidence: D3 ran a whole day with no failures entries or run report until the
  owner asked at 23:41; factory/v1.3 is far ahead of main. Acceptance: (1) the runbook has a run-day checklist: each
  escalation or human intervention goes to `docs/failures.md` the same day, a run report at the end of each run window,
  new lessons become BL items with their FL source; (2) the factory branch is proposed for merge every one to two
  days; (3) the digest shows "failures entries written today" next to "escalations today".

## External review of factory/v1.3 (2026-11-27; written only, not built)
Source: the external review of factory/v1.3 at 0fac327 (15 findings, REQUEST CHANGES; model from another vendor, on
an uploaded archive), `/workspace/runs/plans/factory/v1.3-review/codex-review-factory-v1.3.md`, and the coach's
triage `factory-codex-triage-v1.3.md` in the same folder. Owner decision 2026-11-27 10:00 SGT (recommendation A):
the resume-sg queue keeps running on b3a59f5 with the risk written down (no third-party content reaches the agents
today); PR #6 (v1.3) is not merged into main until Batch 1 is done; Batch 2 is the core of v1.4 (L4), after the
resume-sg launch and before the factory is open-sourced. IDs are the review's F numbers; F01b to F01e are additions
from the operator's container answer of 2026-11-27 10:45 SGT (owner, 11:30 SGT).

### Batch 1 (v1.3.1): small code fixes at the next idle point between tasks, never mid-task
Owner, 11:30 SGT: do it tonight when the queue is empty; list the plan for the owner first; after the work, the
coach reviews it before any "approved to run <sha>".
- [x] **F04 No force pushes.** S, high. Drop `--force-with-lease`; pre-push rejects non-fast-forward updates; a
  restarted task pushes to a new branch `factory/<product>-<n>-r<k>`. Test: a divergent update is rejected; a
  restart uses `-r2`. Owner, 2026-11-28: before the push the coordinator fetches the remote branch and merges
  (never rebases) commits it lacks, such as the owner's "Update branch" merge commit; the new PR of a restart closes
  the earlier one with a link, only when the coordinator opened it (author humyna-bot, head `factory/`). Tests:
  coordinator/test/no-force-push.test.ts, pre-push P5 cases in hooks/test/symlink-guard.test.ts.
- [x] **F07 Scope check sees the rename source.** S, high. `changedFiles` checks the source of a rename too (or uses
  `--no-renames`). Test: `R  src/x.ts <- tests/y.ts` is out of scope for the builder.
- [x] **F08 No quoted file names in the risk check.** S, high. `filesChangedFromBase` uses
  `git diff --no-renames --name-only -z`. Test: a non-ASCII path under a high-risk directory is high risk.
- [x] **F09 Instruction files denied at any depth.** S, high. R3 denies `CLAUDE.md`, `AGENTS.md`, `.gitignore`,
  `.claude/`, `settings/`, `hooks/`, `.githooks/`, `scripts/` at any depth, before the role allow rules. Test:
  `src/CLAUDE.md` and `tests/.gitignore` are denied (added to the mutation fixtures).
  Owner, 2026-11-28: at any depth only `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.gitignore`, `.gitattributes`
  and `.claude/`; `hooks/`, `scripts/`, `settings/` and `.githooks/` only at the repository root (`src/hooks/useX.ts`
  stays writable for the builder).
- [x] **F11 A later session error fails the stage.** S, high. Track errors apart from the verdict: any later result
  event with `is_error` fails the stage; the verdict must match `^(PASS|FAIL)(:|\s*$)` on the first line. Test: the
  two-event stream of the review fails; "PASS is not warranted" is not a pass. (Missed in the reviews of 2982a5f;
  see docs/failures.md 2026-11-27.)
- [x] **F12 Test-defect claims do not override independent failures.** S, high. Drop the Test-defect flag when the
  scope, report or session checks fail on their own; a defect must name an existing `tests/` file and line. Test:
  the review's example goes to the builder failure policy, not to QA. (Missed in the reviews of 71ab18c.)
- [x] **F01a Verify stage stages only what it owns.** S, high. The verify stage stages `feature_list.json` only,
  never `git add -A`; after every gate `git status` shows no change outside what the stage allows, else escalate.
  Test: a test that writes `src/x.ts` during the gate escalates.
- [x] **F01b The factory checkout is unchanged after every gate.** S, high. After every gate, `git status` of
  `/workspace/factory` (the run checkout: coordinator, hooks, roles, settings) must be clean and HEAD must still be
  the approved SHA, else the task escalates with the changed paths. Why: gates run as uid 1000 with `/workspace`
  mounted read-write, so a test can edit the factory's own code and hooks. Test: a gate that touches
  `hooks/path-guard.sh` in a fixture factory checkout escalates.
- [x] **F13 The red gate needs a complete run.** S, high. Reject timeouts and abnormal exits before looking for
  failures. Test: a timed-out run with a failure summary is not a valid red.
- [x] **F15 Repair a truncated event line.** S, high. Before appending, repair a truncated last line of
  `events.jsonl`. Test: a partial line does not swallow the next event.
- [x] **F03 Pre-push scans every outgoing commit.** S, high. `gitleaks` over `base..HEAD`, not only the tree. Test: a
  token added and then removed blocks the push. Owner, 2026-11-28: no gitleaks in the container; pre-push rule P6 runs
  the added lines of every outgoing commit through `hooks/secret-guard.sh --stdin` and fails closed if the scanner is
  missing or cannot run. CI keeps gitleaks.
- [x] **F16 The fail-first check runs on the task baseline plus the new tests.** S, high. Owner, 2026-11-28
  (resume-sg#48): after a QA rewrite the red check ran on the task worktree, which already held a committed builder
  attempt, so every test passed ("tests do not fail first"). `ShellGates.red` now creates a temporary worktree at
  the base SHA recorded when the task worktree was created (else `git merge-base HEAD origin/<base>`), under
  `<runs>/red/` with a unique name, removed in `finally`; it applies the branch diff of `tests/` and `evals/`,
  installs with `pnpm install --offline --frozen-lockfile` and runs the red gate there with the usual gate
  environment (owner, 2026-11-28). Never skipped; the task worktree is never changed. Test:
  coordinator/test/red-baseline.test.ts.

### Batch 2 (v1.4 / L4): after the resume-sg launch, before open-sourcing
- [ ] **F01/F02 Gates and agent tools in a separate sandbox.** L, high. Candidate code read-only, no token, no
  network, narrow writable temp dirs; read-path rules for `.env`, PII maps and `data/private` enforced by the mount,
  not by command patterns.
- [ ] **F01c Gates and tests run as another user.** M, high. Run gates and tests as a user that cannot read other
  processes' environment (today every process is uid 1000, so a test can read `/proc/<pid>/environ` of the
  coordinator, the tmux sessions and the Claude sessions, which hold `GH_TOKEN`, `FACTORY_GH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN` and the Telegram tokens), and cannot read the 0600 files of `node`
  (`~/.claude/.credentials.json`, `~/.claude.json`, `~/.claude/channels/telegram/.env`).
- [ ] **F01d Credentials the factory does not use leave the container.** S, high. Move `~/.codex/auth.json` (the
  `agent-factory_codex-config` volume) out of the container while Codex is not part of a run.
- [ ] **F01e No long-lived tokens in process environments.** M, high. The bot token is not kept in the environment
  of long-running processes (start-sessions, tmux, the coordinator, the Claude sessions); a short-lived token is
  fetched for the one `gh` or `git push` call that needs it.
- [ ] **F05 A rerun resets auto-merge.** M, high. On a rerun, look up the PR first, disable auto-merge, refresh body
  and labels, and re-enable only after the new decision.
- [ ] **F06 Resume checks commits, not labels.** M, high. Completed-stage events record the HEAD SHA; resume checks
  it; restart is idempotent.
- [ ] **F10 Grants bound to the task revision.** M, high. A task authorization snapshot (issue revision, risk,
  grants, candidate SHA); a change forces a restart.
- [ ] **F14 PR state survives an interruption.** S, high. Persist the PR number, URL, SHA and auto-merge state in the
  stage event; restore them on resume.
- [ ] **F01f Gates cannot write /workspace outside the task.** M, high. Owner, 2026-11-28: F01b only checks the
  factory checkout; a gate process can still write other directories under /workspace (for example `runs/plans/`,
  other worktrees, the run ledger). Solved by the isolated sandbox of F01/F02 (the gate sees only its task worktree
  and a temp dir, writable), not by more after-the-fact checks.
- [ ] **FL-43 A restart refuses to start while a test changed on both sides is unlisted.** S, low. Owner, 2026-11-28
  22:30 SGT (written only, not built; resume-sg#49): on a restart the coordinator computes the tests changed both on
  main since the previous run's base and on the previous task branch, `comm -12 <(git diff --name-only <base>
  origin/main -- tests | sort) <(git diff --name-only <base> <previous branch tip> -- tests | sort)`, and does not start
  the task if a file of that intersection is not named in the issue's "Existing tests affected" line. Evidence: the
  #49 restart of 2026-11-28 escalated because tests/unit/result-fixes-markdown.test.tsx, changed by #52 (#67) and by
  #49 (702fc26), was missing from that line.

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
- [ ] **BL-14 Telegram command bot (R-06, spec 3.9 bot B).** L, high. Source: FL-04 item 3, partly (review after resume-sg). Deps: BL-11. Principles: P-11, G-02, G-07.
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
- [ ] **BL-20 Gradual loosening of risk levels (spec 3.5 item 7).** M, high. Source: FL-01, partly; see BL-38 (review after resume-sg). Deps: 4 weeks of data. Principles: P-11.
  Acceptance: an ADR per loosened class; automatic tightening on the first failure.
- [ ] **BL-21 Verify the required status check names after the first CI run.** S, high (human). Deps: H-02.
  Acceptance: `CHECKS` in `scripts/setup-repo.sh` matches the names GitHub shows.
- [ ] **BL-22 Golden eval in claude mode.** M, low. Deps: BL-11. Acceptance: `node evals/golden/run.ts --runner claude` exists, runs on a budget cap, and is required before prompt or CLI changes.
