# Failures that needed a human

Rule 3 of `docs/principles.md`: every failure that needed a human gets an entry here. When the
same failure class is solved, add a note to `docs/playbook/` (rule 4).

Template:

```
## YYYY-MM-DD <short title>
- Symptom:
- Root cause:
- Principle: P-xx / G-xx
- Fix:
- Issue: <link>  PR: <link>
```

## 2026-11-25 Requirement R-04 cannot hold literally while the design docs quote it
- Symptom: the structure test for "the bypass flag appears nowhere in this repository" found
  the flag in `docs/design/brief-D2.md`, `docs/design/factory-spec.md` and
  `docs/design/kickoff-D2.md`, which agents may not edit.
- Root cause: the documents that forbid the flag spell it out.
- Principle: G-01 (a check proves only what it ran), P-05.
- Fix: the test exempts exactly those three human-owned files and nothing else; the read-back
  names the flag in words. Proposal to the human in `docs/reports/2026-11-25-D2-phase1.md`.
- Issue: none yet. PR: the D2 Phase 1 pull request.

## 2026-11-25 setup-repo.sh read-back: OrganizationAdmin bypass actor id is null
- Symptom: the first real `setup-repo.sh --owner-bypass` run, on `humyna-labs/factory` and on
  `humyna-labs/resume-sg`, failed its read-back on `bypass_actors`: expected
  `OrganizationAdmin:1:pull_request`, GitHub has `OrganizationAdmin:null:pull_request`. Every earlier
  field matched. The ruleset was already applied, so the repositories were in the intended state.
- Root cause: GitHub stores no actor id for the OrganizationAdmin actor type. The script compared a field
  written from memory (ADR 0002 flagged it), and the fake `gh` echoed request bodies back unchanged, so
  no test could fail on it (verifier P4). The bypass works: `current_user_can_bypass: "pull_requests_only"`
  and the bypass checkbox on the PR page.
- Principle: G-01, G-02.
- Fix: v1.2 compares an OrganizationAdmin bypass by type and mode and accepts `actor_id` null or 1; any
  other id or mode still fails. The fake `gh` now stores null like GitHub. Flow scenarios and a
  mutation check (`scripts/test/flow-kit.ts`, CHECK S1). Playbook: `fakes-store-what-the-service-stores.md`.
- Issue: none. PR: the `factory/v1.2` pull request.

## 2026-11-25 Machine token was pending organization approval (the real cause of F1)
- Symptom: in the morning, pushing `factory/v1` as `humyna-bot` failed with 403 (F1). ADR 0002 read it as
  missing write access and planned a role change.
- Root cause: the fine-grained token had been "pending organization approval" since it was created, so it
  could reach nothing. A 403 does not say why; nobody checked the token's state before first use.
- Principle: G-01 (the error proved only "denied"), G-02, P-02.
- Fix: the owner approved the token with repositories `factory` and `resume-sg` only (condo-demo removed);
  Contents, Pull requests, Issues read and write; Checks, Commit statuses, Actions read; nothing else.
  The runbook now has a token check before first use; a `check-bot-access` script is backlog BL-27.
- Issue: none. PR: the `factory/v1.2` pull request (docs).

## 2026-11-25 Cloudflare "Create application" opens a Workers flow, not Pages
- Symptom: runbook H-03 (written from memory) said "Create, Pages, Connect to Git". The dashboard's
  "Create application" now opens a Workers flow with the deploy command `npx wrangler deploy` and
  Cloudflare autoconfig pull requests.
- Root cause: a dashboard change; the H-03 steps had never been run. Autoconfig PRs would change deploy
  configuration (a high-risk path) outside the factory's review.
- Principle: G-04, P-11.
- Fix: the owner chose "Continue to Pages" (labelled legacy), framework preset None (not VitePress), build
  `corepack enable && pnpm install --frozen-lockfile && pnpm build`, output `dist`, `NODE_VERSION=22`. Live at
  https://resume-sg.pages.dev with CSP, `x-frame-options: DENY`, `nosniff`, `referrer-policy: no-referrer`.
  Runbook H-03 rewritten from that run. Moving to Workers static assets through a reviewed template PR,
  never through autoconfig PRs, is backlog BL-25.
- Issue: none. PR: the `factory/v1.2` pull request (docs).

## 2026-11-26 First live task resume-sg#4 escalated on four factory bugs (408 blocked actions)
- Symptom: the first live run of #4 app-shell escalated after 3 builder attempts at 11:29 SGT. The digest
  counted 408 blocked actions; QA's tests had never run (Vitest could not start); the builder reported a test
  that contradicts the issue and had no way to get it fixed.
- Root cause: (1) path-guard logged one block as several multi-line guard.log entries, and the coordinator
  added them on top of the session's own denials; (2) QA ran `npx vitest`, which crashed on a missing package,
  and the tests stage accepted "the tests fail" without checking that tests actually ran and failed;
  (3) the state machine sent every builder failure back to the builder, never to QA, although only QA may edit
  tests; (4) gates and role sessions lacked `PLAYWRIGHT_BROWSERS_PATH` in the minimal env (R-05).
- Principle: G-01 (a check proves only what it ran), P-01, P-02.
- Fix: factory/v1.3 commits 1efafa2 (env), 2f61017 (one guard.log line per block; blocked = max of the two
  counts), b3ecb14 (a red check needs a failing-tests line from Vitest or Playwright; QA runs checks only through
  pnpm scripts; a builder `Test-defect:` line sends the task back to QA once). Each with tests and a mutation
  check. Re-run passed; PR auto-merged.
- Issue: https://github.com/humyna-labs/resume-sg/issues/4, harness-fix https://github.com/humyna-labs/factory/issues/5
  PR: https://github.com/humyna-labs/resume-sg/pull/16, factory https://github.com/humyna-labs/factory/pull/6

## 2026-11-26 resume-sg#4 cancel recovery: operator session interrupted, then the pr stage crashed on push
- Symptom: the owner interrupted the operator session twice by mistake (11:30 and 11:32 SGT) while #4 was being
  diagnosed, then wrote "continue" (11:35). The re-run of #4 passed every stage, but the coordinator exited at
  the pr stage: `git push ... failed: fatal: could not read Username for 'https://github.com'`. The issue was left
  on `factory:pr` with no PR.
- Root cause: the interrupts only stopped the operator's turn; the coordinator runs in its own process, so nothing
  was lost. The push failure was a real bug: git runs with the minimal env (R-05), and the credential helper is
  `gh auth git-credential`, which needs `GH_TOKEN`.
- Principle: P-01 (deterministic code drives the task), P-06 (resume from durable state).
- Fix: 70b2433 (the coordinator's push gets `GH_TOKEN`; mutation-checked). The next queue cycle resumed #4 from its
  `factory:pr` label and events.jsonl (`task-resume`, interrupted 1), opened PR #16 once and enabled auto-merge;
  no duplicate PR or ledger row. Lesson for the coach's FL-13: after a cancel, read the labels and the last
  events.jsonl lines before doing anything; the queue resumes from them.
- Issue: https://github.com/humyna-labs/resume-sg/issues/4  PR: https://github.com/humyna-labs/resume-sg/pull/16

## 2026-11-26 Builder could not write the high-risk paths its issues needed (#7, #13)
- Symptom: #7 byok-anthropic needed `public/_headers` and `src/security/**`, #13 templates needed
  `src/templates/**`; path-guard rules R6, R7 and B3 block those for every role by design.
- Root cause: v1.2 had no way to let one high-risk issue touch one high-risk path.
- Principle: P-05 (guardrails in code), P-11 (risk levels), G-05 (a block is a stop sign).
- Fix: owner option 1 with conditions. Grants (8251893 rule G1, 753dddf, bf398eb): only for a `risk:high` issue
  opened by humyna-bot or humyna whose `Grants:` line lists only `public/_headers`, `src/security/**` or
  `src/templates/**`; listed at the top of the PR body; extra reviewer checks. Run only after
  "grants approved for bf398eb" (owner, 12:30 SGT). Used by #7, #13 and #29, all merged by the owner.
- Issue: https://github.com/humyna-labs/resume-sg/issues/7, https://github.com/humyna-labs/resume-sg/issues/13
  PR: https://github.com/humyna-labs/resume-sg/pull/23, https://github.com/humyna-labs/resume-sg/pull/33

## 2026-11-26 resume-sg#6 base-resume took four runs: stale base, stale local main, pre-push range
- Symptom: PR #18 became DIRTY after #22 (design-system) merged, so its auto-merge could never land (owner,
  13:35 SGT). The re-run failed compliance: the role saw #5's contact email in the diff. The next re-run passed
  every stage, but pre-push refused the update push.
- Root cause: (1) the queue started the next task while an earlier auto-merge had not landed, so #6 branched from
  a main without #22; (2) role prompts compared against the local `main` of the product clone, which was behind
  origin, so #5's merged content showed up as part of #6's diff; (3) pre-push checked every commit in
  `local_sha --not remote_sha`, which on an update branch includes base commits authored by others.
- Principle: G-01, P-01, R-07.
- Fix: 368436f and f132053 (the queue waits up to 30 min for an auto-merge to land; DIRTY ends the wait as a
  conflict), 5506da7 (a re-run reuses the open PR and its auto-merge), 2c01d39 (prompts name `origin/<base>`;
  the operator fast-forwards the clone's main before each cycle), da0bbf0 (pre-push checks only commits no
  remote has). Owner: "approved to run da0bbf0" (14:10 SGT). Backlog BL-32 (trust only freshly fetched refs).
- Issue: https://github.com/humyna-labs/resume-sg/issues/6, harness-fix https://github.com/humyna-labs/factory/issues/7
  PR: https://github.com/humyna-labs/resume-sg/pull/18

## 2026-11-26 A gitleaks false positive blocked every PR
- Symptom: from 14:15 SGT the CI job "gates / secrets" failed at "gitleaks (full history)" on PR #26 and on PR #18.
  The log was not readable from the container.
- Root cause (owner, 14:45 SGT): the generic-api-key rule matched the i18n key name `disclaimer.5.body` after the
  words "Your API key." (`src/i18n/en.ts:168`, commit 4706afa on PR #26). The CI scans every branch, so one
  branch failed every PR.
- Principle: G-01, P-05.
- Fix: the owner merged `.gitleaks.toml` (default rules plus one allowlist for dotted lowercase identifiers with
  3+ parts) in resume-sg#27 and pressed Update branch. Backlog BL-33 (scan the PR's range plus main), BL-34 (the
  gitleaks files are high-risk paths), BL-35 (secret-guard flags new allow comments).
- Issue: none. PR: https://github.com/humyna-labs/resume-sg/pull/27 (owner), https://github.com/humyna-labs/resume-sg/pull/26

## 2026-11-26 The owner had to press Update branch again and again
- Symptom: the strict ruleset requires a PR to be up to date with main. PR #18 and PR #26 after #27, and PR #40 after
  #39 merged: each was BEHIND and waited for the owner to press Update branch. The owner once confused Re-run with
  Update branch (a re-run tests the old merge SHA; coach FL-03).
- Root cause: nothing in the factory brings an open PR up to date after another PR merges; high-risk PRs approved
  in a batch go BEHIND one after the other.
- Principle: P-01, G-02.
- Fix: not built. Backlog BL-31 (urgent, owner 13:35 SGT), source FL-03.
- Issue: none. PR: https://github.com/humyna-labs/resume-sg/pull/18, /pull/26, /pull/40

## 2026-11-26 resume-sg#25 model-picker: QA's query matched two textboxes
- Symptom: escalated at 15:06 SGT after one QA rewrite and two builder Test-defect reports.
- Root cause: QA's tests looked for "the" textbox on `#/app`, where the base-resume editor has textboxes too; the
  same class as #4 (a query that is not unique on the page).
- Principle: G-01, P-02.
- Fix: the issue got a testing note (scope queries to the AI settings region); one re-run passed and auto-merged.
  `roles/qa.md` v1.1 already asks for landmark-scoped queries.
- Issue: https://github.com/humyna-labs/resume-sg/issues/25, harness-fix https://github.com/humyna-labs/factory/issues/8
  PR: https://github.com/humyna-labs/resume-sg/pull/28

## 2026-11-26 Owner hold and brief v5.2 restructured running issues
- Symptom: at 15:08 SGT the owner held #8, #9, #10, #11, #12, #15 and #21 (the structured editor as the first
  screen was rejected). #8 was stopped at the stage boundary after its tests passed.
- Root cause: the user-visible flow had not been drawn and approved before the issues were split (coach FL-06).
- Principle: P-12, G-04.
- Fix: brief v5.2 (15:25 SGT): #8 revised, #9, #10 and #15 closed and replaced by #30 and #31, #29 added. The
  factory had no way to restart a revised task: cb265c9 adds `run --task <n> --restart "<reason>"` (refuses closed
  issues and PR stages, writes a task-restart event, removes the worktree). Owner approval of 71ab18c (16:12 SGT).
- Issue: https://github.com/humyna-labs/resume-sg/issues/8  PR: https://github.com/humyna-labs/factory/pull/6

## 2026-11-26 resume-sg#13 templates: the second Test-defect never reached QA
- Symptom: escalated at 15:35 and again at 16:03 SGT. The builder named two wrong tests; QA fixed only the first.
- Root cause: the runner forwarded only the first `Test-defect:` line to QA. The second defect was an existing
  base-resume test expecting separate Certificates and Languages headings, which the templates spec merged; that
  needed an owner decision.
- Principle: G-01, P-02.
- Fix: 71ab18c (every Test-defect line, up to 4, reaches QA). Owner 16:12 SGT: Certificates and Languages are
  always separate sections. The re-run passed; PR #33 merged by the owner.
- Issue: https://github.com/humyna-labs/resume-sg/issues/13, harness-fix https://github.com/humyna-labs/factory/issues/9
  PR: https://github.com/humyna-labs/resume-sg/pull/33

## 2026-11-26 resume-sg#8 fact-check: a review test gap went to the builder
- Symptom: escalated at 16:28 SGT after 3 builder attempts. The code converged, but each review asked for unit
  tests for criterion 3.
- Root cause: review failures go back to impl, and the builder may not write tests; only QA can close a test gap.
- Principle: P-02, G-05.
- Fix: owner 16:50 SGT: one line "Tests must cover: ..." with the reviewer's exact finding added to the issue, and a
  restart from tests. It then passed every stage first time; PR #34 merged by the owner. BL-37 (review test gaps
  go to QA) stays for the factory review.
- Issue: https://github.com/humyna-labs/resume-sg/issues/8, harness-fix https://github.com/humyna-labs/factory/issues/10
  PR: https://github.com/humyna-labs/resume-sg/pull/34

## 2026-11-26 resume-sg#36 fact-check-2: a cross-language rule the operator should have questioned
- Symptom: after the owner approved PR #37, the coach found that the 17:20 rule is wrong for a Chinese original with
  English output: the fixture had to keep company and title in Chinese to pass.
- Root cause: the operator turned the rule into an issue as written and let QA bend the fixture, instead of asking.
- Principle: G-04 (ask when the spec and reality disagree).
- Fix: fact-check-3 (#38) with the owner's corrected rules; from 18:20 SGT conflicts like this go to the owner as a
  question first (three were asked and answered at 19:50).
- Issue: https://github.com/humyna-labs/resume-sg/issues/36, https://github.com/humyna-labs/resume-sg/issues/38
  PR: https://github.com/humyna-labs/resume-sg/pull/37

## 2026-11-26 Second wrong QA test with no rewrite left (#38, #11, #42)
- Symptom: #38 fact-check-3 escalated at 20:05 SGT (768 of 769 tests passed), #11 page-fit at 22:30 SGT (code
  done). In both, the first wrong test went back to QA and was fixed; a second, different wrong test then had no
  QA re-run left (`MAX_TEST_REWRITES = 1`). #38: a test expected a Chinese item to be "not found", but its own
  fixture contained it inside a longer item. #11: an e2e test expected bullets to move for a long sample resume
  that already fits its 2-page target.
  #42 ui-polish (23:50 SGT) is the third case: QA fixed two older tests that contradict the issue, then
  `tests/e2e/design-system.spec.ts:67` still expected the zh header sub-label the issue removes.
- Root cause: QA writes tests without running them against any implementation, and one rewrite per task is too
  few for large issues; the e2e case was written for a layout QA never measured; in #42 older tests asserted
  behaviour the new issue changes, and the builder finds them one stage at a time.
- Principle: P-02, G-01.
- Fix: per owner, a test note in the issue and a restart (#38: 20:22, passed, PR #39 merged; #11: 22:45 with the
  reason "e2e sample resume too short"). Two QA rewrites is BL-36 and stays for the factory review (owner 22:45).
- Issue: https://github.com/humyna-labs/resume-sg/issues/38, https://github.com/humyna-labs/resume-sg/issues/11,
  https://github.com/humyna-labs/resume-sg/issues/42,
  harness-fix https://github.com/humyna-labs/factory/issues/11, https://github.com/humyna-labs/factory/issues/13
  PR: https://github.com/humyna-labs/resume-sg/pull/39

## 2026-11-26 resume-sg#11 page-fit: QA's PASS overwritten by a follow-up turn
- Symptom: escalated at 21:39 SGT in the tests stage, with the reason "The monitor was only waiting on the Explore
  subagent, which had already finished, so there's nothing left to re-arm." QA's report said Done.
- Root cause: QA started an Explore subagent and a Monitor. After its PASS verdict, their notification started one
  more turn with its own `result` event; the runner kept only the last result event. A failed tests stage
  escalates at once.
- Principle: G-01, P-01.
- Fix: 2982a5f (the verdict comes from the last result event that starts with PASS or FAIL; turns summed; cost and
  blocked actions are the session maximum); 6 tests, 5 mutation checks, golden task. Owner: "approved to run
  2982a5f" (22:40 SGT). The restart kept QA's PASS.
- Issue: https://github.com/humyna-labs/resume-sg/issues/11, harness-fix https://github.com/humyna-labs/factory/issues/12
  PR: https://github.com/humyna-labs/factory/pull/6

## 2026-11-26 resume-sg#41 flow-wizard: QA ran out of turns
- Symptom: escalated at 22:45 SGT in the tests stage: "report missing". The session ended `error_max_turns` at 40
  turns ($1.56) before QA wrote tests or its report.
- Root cause: a large issue (13 criteria, five steps, a dialog, a 15 KB reference) against QA's 40-turn limit; two
  shell commands naming `src/` were blocked by B4 and cost turns.
- Principle: P-07 (budgets), P-12 (small tasks).
- Fix: not restarted. Options in the issue: split it, or a larger QA budget for large issues (backlog BL-52).
- Issue: https://github.com/humyna-labs/resume-sg/issues/41, harness-fix https://github.com/humyna-labs/factory/issues/14
  PR: none

## 2026-11-26 resume-sg#11 page-fit: an orphan preview server held port 4173
- Symptom: escalated at 23:05 SGT: tests and code were done, verify failed on e2e, and builder attempts 2 and 3
  reported that `pnpm e2e` could not start because port 4173 was in use.
- Root cause: #41's QA session hit its turn limit while Playwright's web server (`pnpm build && pnpm preview`) was
  running. Playwright starts that server in its own process session, so it outlived the role session and the
  coordinator never stopped it.
- Principle: P-05, G-01.
- Fix: the operator stopped the orphan's process group at 23:14 SGT; owner approved a restart on 2982a5f. Backlog
  BL-50 (stop every process left in a worktree after each role session and gate run).
- Issue: https://github.com/humyna-labs/resume-sg/issues/11  PR: none

## 2026-11-26 resume-sg#42 ui-polish: the issue named paths the builder may not write
- Symptom: escalated at 23:12 SGT. The builder's first attempt wrote `index.html` and was rejected as out of scope;
  attempts 2 and 3 stopped because the SVGs belong in `public/illustrations/`.
- Root cause: operator error: the issue's Paths section named `index.html` and `public/`, while the builder may
  write only under `src/` (R7). Nothing checks an issue's paths against the role rules before it is opened.
- Principle: G-04, P-05.
- Fix: owner 23:20 SGT: the SVGs go to `src/assets/illustrations/` (same bytes, imported by Vite, still `<img>`),
  the meta description is set at runtime; restarted. Backlog BL-51 (check issue paths against the builder's write
  rules when an issue is drafted).
- Issue: https://github.com/humyna-labs/resume-sg/issues/42, harness-fix https://github.com/humyna-labs/factory/issues/15
  PR: none yet

## 2026-11-26 resume-sg#11 page-fit: three review majors in a row
- Symptom: escalated at 23:39 SGT after the third builder attempt. All gates passed each time; each review found
  one major in the Put back / Add it back logic (a fact-check decision moved put-back bullets out again; an
  added-back line was the first one tightening moved out; finally the added-back line made the resume miss its
  page target).
- Root cause: the builder re-applied the user's override after the optimiser instead of passing it in as a
  constraint, and no test covered the case, because review findings go to the builder, not to QA.
- Principle: P-02, G-01.
- Fix: open. The reviewer's finding is quoted on the issue. BL-37 (review test gaps go to QA) would have added the
  test first.
- Issue: https://github.com/humyna-labs/resume-sg/issues/11, harness-fix https://github.com/humyna-labs/factory/issues/16
  PR: none

## 2026-11-27 After the owner's 00:00 restarts: two more second wrong tests, and an origin check QA could not loosen
- Symptom: #11 page-fit escalated at 00:52 SGT (988 unit tests and 150 of 151 e2e pass), #41 flow-wizard at 01:08
  SGT (992 of 998 unit tests pass), #44 templates-polish at 01:17 SGT (code done, gates passed). #42 ui-polish
  passed and auto-merged (PR #45) after its "Tests must change" line.
- Root cause: #11 and #41: the same class as the 2026-11-26 entry "Second wrong QA test with no rewrite left": QA
  fixed the first wrong test, and the next ones (#11: an e2e bullet count that includes the certificates the
  template also draws as bullets; #41: a double click on a button that the first click removes, a Generate query
  on step 2, a tabindex rule that rules out the heading focus criterion 10 requires) had no QA re-run left. #44: the
  review found a missing e2e case; the builder sent it to QA, QA built the case through a mocked AI call, and its
  one-line exemption for that call in the test's origin check was refused by auto mode as weakening oversight; a
  tests-stage failure escalates at once.
- Principle: P-02, G-05 (QA did not route around the refusal).
- Fix: none tonight (owner: post the finding and move on). The builders' lists are on the issues. BL-36 and BL-37
  stay for the factory review.
- Issue: https://github.com/humyna-labs/resume-sg/issues/11, https://github.com/humyna-labs/resume-sg/issues/41,
  https://github.com/humyna-labs/resume-sg/issues/44, harness-fix https://github.com/humyna-labs/factory/issues/18
  PR: https://github.com/humyna-labs/resume-sg/pull/45 (#42, merged)

## 2026-11-27 Reviewed fixes 2982a5f and 71ab18c missed F11 and F12 of the external review
- Symptom: the external review of factory/v1.3 (0fac327) found two HIGH defects in code the coach had reviewed and
  passed and the owner had approved to run. F11 (2982a5f, `coordinator/src/runner/claude.ts` `summarizeStream`):
  once a verdict is seen, later result events that do not start with PASS or FAIL are skipped with their `is_error`
  and `subtype`, so a PASS followed by an `error_max_turns` event is a pass; and `PASS is not warranted; tests
  failed` matches the verdict pattern. F12 (71ab18c, Test-defect routing): any text after `Test-defect:` counts,
  and the flag survives when the coordinator itself finds unauthorized writes or an invalid report, so the builder
  can send a task back to QA without a real defect.
- Root cause: both fixes were written by the operator and reviewed by the coach against the run that had failed
  (#11's two result events; #41's list of defects) and their unit tests, not against a hostile or out-of-order
  event stream or a builder that lies. Live example the same day: #41's review attempt 3 (11:16 SGT) emitted a
  second result event after its verdict, "PASS: this review already finished, so nothing changed; ...", which the
  parser took as the verdict; harmless only because the real verdict was also PASS.
- Principle: G-01 (a check passes only when it is run), P-02.
- Fix: F11 and F12 in docs/backlog.md, Batch 1 (v1.3.1), with the review's two-event stream and example as tests.
  Lesson (coach): a parser review must try a hostile or out-of-order event stream, not only the run that failed.
- Issue: none (external review `/workspace/runs/plans/factory/v1.3-review/codex-review-factory-v1.3.md`)
  PR: https://github.com/humyna-labs/factory/pull/6 (not merged until Batch 1 is done)

## 2026-11-27 resume-sg#47 result-fixes: QA ran out of turns, third time for this class
- Symptom: escalated at 11:27 SGT on b3a59f5 at the tests stage: QA ran 41 turns (`error_max_turns`, limit 40) and
  ended before writing its report, so the stage failed with "report missing"; a tests-stage failure escalates at
  once. Cost USD 1.96. Earlier the same day #41 flow-wizard, restarted on b3a59f5, used its first QA rewrite and
  reached the owner as PR #50.
- Root cause: the same class as #41 (2026-11-26 22:45) and #11 (2026-11-27 08:14): a large issue (nine criteria
  plus test notes) and turns spent on commands path-guard B4 blocks (6 blocked actions, the last a `grep` of
  `src/i18n/`).
- Principle: P-12 (split large issues), P-02.
- Fix: open; queue stopped under the same-failure rule. Owner to choose: QA turn budget (BL-52) or split the issue.
- Issue: https://github.com/humyna-labs/resume-sg/issues/47
  PR: none

## 2026-11-28 resume-sg#52 fact-check-4: the secret scan never ran, chained with a harness path
- Symptom: escalated at 00:13 SGT on fff6b5c at the compliance stage, after review 3 passed (0 blockers, 0 majors)
  and builder attempt 3 passed every gate (1360 unit, 199 e2e). Compliance (haiku) reported "secret scan not run,
  blocked by path-guard B2" and failed the stage as G-05 requires. Cost USD 5.50 for the run.
- Root cause: the role chained `/workspace/factory/hooks/secret-guard.sh --scan-git` in one shell command with
  `cat .factory/factory.yaml` and with a grep pattern containing `\.github/`. B2 matches harness names anywhere in
  the command text, so the whole command was denied and the scanner never ran. The scanner alone was always
  allowed (case "compliance bash allow" in hooks/test/cases.ts); in #11, #41, #44, #47 and #53 the role ran it as a
  command of its own and passed. The coordinator's draft (factory#20) proposed loosening the guard.
- Principle: G-05 (a block is a stop sign), P-02 (fix the harness), P-11 (security paths keep strict gates).
- Fix: owner, 2026-11-28 (factory#20 option A): only the role prompt changes, no hook rule is loosened.
  `roles/compliance.md` 1.1 says the first shell command is exactly the scanner, with nothing chained, and harness
  files are read with the Read tool. Tests: `hooks/test/compliance-scan.test.ts` (fails on the 1.0 prompt and on a
  prompt whose code block chains a harness path) and three B2 cases in `hooks/test/cases.ts` (the two chained forms
  of #52 are denied, a `cd` prefix is allowed).
- Issue: https://github.com/humyna-labs/resume-sg/issues/52, https://github.com/humyna-labs/factory/issues/20
  PR: none (resume-sg#52 is restarted after the coach's review and the owner's approval of the run SHA)

## 2026-11-28 resume-sg#48 match-analysis: the red check after a QA rewrite ran on a committed implementation
- Symptom: escalated at 15:34 SGT on fff6b5c at the tests stage with "red check: unit passed before implementation:
  tests do not fail first". Builder attempt 1 had passed every gate; review 1 found a major; builder attempt 2
  reverted it and reported two test defects; QA rewrote one test. Cost USD 3.44. The coordinator's draft
  (factory#21, a Grep tool for QA) did not name the cause.
- Root cause: `runStage` "tests" runs `ShellGates.red` on the task worktree. After a rewrite, that worktree still holds
  the committed builder attempt 1 (attempt 2 failed and was reset), so the new tests pass there.
- Principle: P-06 (tests fail first), P-02.
- Fix: F16 (owner, 2026-11-28): the red check runs only on the task baseline plus the task's `tests/` and `evals/`
  changes, in a temporary worktree that is always removed. Test: coordinator/test/red-baseline.test.ts (fails
  before the fix; mutation: running the gate on the task worktree again, or not applying the test diff, turns it
  red). The #48 restart on 17:34 SGT reached the owner as PR #66.
- Issue: https://github.com/humyna-labs/resume-sg/issues/48, https://github.com/humyna-labs/factory/issues/21
  PR: https://github.com/humyna-labs/resume-sg/pull/66
