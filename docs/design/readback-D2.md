# Read-back D2: walking skeleton

Status: Confirmed by the human on 2026-11-25 with corrections. The corrections are in section 9 and
they override any earlier line of this file.
Sources read completely: `docs/design/kickoff-D2.md`, `docs/design/brief-D2.md`,
`docs/design/factory-spec.md`, `docs/principles.md`, `docs/templates/run-report.md`,
`docs/templates/handoff.md`.

## 0. Environment facts I checked (verified by running, 2026-11-25)

| Fact | How checked |
|---|---|
| Node v22.23.5, npm 10.9.9, pnpm 12.23.0 (fetched by corepack, so the npm registry is reachable) | `node -v`, `pnpm -v` |
| Claude Code 2.1.331; `--permission-mode` accepts `auto`; `--settings`, `--model`, `--output-format`, `--max-budget-usd`, `--disallowedTools`, `-w/--worktree` are listed | `claude --help` |
| `--append-system-prompt-file` and `--max-turns` are NOT listed in `claude --help` (they may be hidden flags). The help text mentions `--append-system-prompt[-file]`, so the file variant probably exists. I will use both flags as the kickoff asks, and mark them "unverified flag" in the report | `claude --help` |
| `jq`, `timeout`, `gh` 2.105.0 present. No `chromium`, no Playwright browser cache, no `gitleaks`, no `shellcheck`. Only bash 5.2 (aarch64), no bash 3.2 | `which`, `bash --version` |
| `/workspace/runs/` exists and is empty | `ls` |
| Git identity is the machine account `humyna-bot`; no `core.hooksPath` set yet | `git config` |

## 1. Requirements in my own words

- **R-01** Build one thin end-to-end path (issue, tests, implementation, verify, review, compliance, PR, merge) with stub stages first. Make no stage rich before the whole path works.
- **R-02** Only the deterministic coordinator merges PRs and changes workflow-state labels. No LLM session gets a code path to merge. Checked by a code search test plus a unit test on the merge path.
- **R-03** One writing agent per task, in its own worktree. Every other role is read-only. A path-guard hook enforces this; instructions alone are not enough.
- **R-04** Every `claude` session the factory starts passes `--permission-mode auto` explicitly. The string `--dangerously-skip-permissions` appears nowhere in the repo. Each run counts the actions that were blocked.
- **R-05** Code reads only the environment variables it names, never prints or logs the environment, and never reads `/proc/*/environ` or another process's environment. The bot (in the backlog) reads exactly three variables and runs as its own service.
- **R-06** Backlog only: a Telegram command bot that handles private chats only, accepts only `from.id == TELEGRAM_ALLOWED_USER_ID`, and silently drops and logs everything else. It only changes labels and never merges high-risk PRs. Acceptance includes a stranger test with fake updates.
- **R-07** Commits come from the machine account, are small and ASCII, and carry an `Agent-Role:` trailer. Agents push feature branches only. A pre-push hook rejects any remote whose owner is not `humyna-labs`.
- **R-08** Every human step is one idempotent, self-checking command. It sets timeouts on network calls, runs on macOS bash 3.2, has `--dry-run`, and prints ASCII. Any variable next to non-ASCII text is written `${VAR}`. Checked by `bash -n` and a lint test.
- **R-09** Every escalation appends a `runs.csv` row with `escalated=true` and a one-line `harness_fix`. It also drafts a `harness-fix` issue with context, reproduction, expected behaviour, proposed change and acceptance criteria.
- **R-10** `runs.csv` lives at `/workspace/runs/runs.csv` with the exact header `task,stage,role,start,end,turns,cost,outcome,escalated,harness_fix`. Timestamps are UTC ISO 8601. `outcome` is in {pass, fail, auto-merge, needs-human, escalated} and `escalated` is in {true, false}. No personal data. Append-only. A schema test checks all of this.
- **R-11** `docs/principles.md` drives decisions. ADRs and harness-fix PRs cite principle IDs, deviations are recorded, `docs/failures.md` is kept, and reusable practices go to `docs/playbook/`.
- **R-12** `coordinator run --queue --max-hours N` takes ready tasks by priority, never waits for input, skips blocked tasks, and ends with a digest: done, needs human, escalated, blocked actions, cost.
- **R-13** Deploys use Cloudflare Pages Git integration only. No Cloudflare credential, token or API call anywhere in the code.
- **R-14** If the firewall blocks a domain, I record the domain and the step in the report and stop that step. No mirrors or workarounds.
- **R-15** Every report separates "verified by running" from "written, not run". I never claim something passed unless I ran it.
- **R-16** Guards are mutation-checked. For the path guard and the secret scan, break each rule in a scratch copy and show that a test fails.
- **R-17** Read-back before building (this file). Trace matrix at the end (`docs/design/trace-D2.md`).
- **R-18** Workflow files are high risk. Agents write them under `ci/workflows/`, never under `.github/workflows/`. A human-run script installs them after review.
- **R-19** Factory changes reach `main` only through a PR that the human reviews. I work on `factory/v1` and open a PR.
- **R-20** Every run ends with a report at `docs/reports/YYYY-MM-DD-<handoff ID>.md`, written from the template with sections 5 to 8 filled in. The coordinator also requires a report from every role session it runs, and a unit test proves a missing report fails the stage.
- **R-21** Backlog only, with acceptance criteria: a `Stop` hook that blocks ending a session while its report is missing (exit 2 or `{"decision":"block",...}`), and a `SessionStart` hook that injects `progress.md` and open escalations.

## 2. Conflicts between spec and brief or kickoff (the brief and kickoff win)

| # | Spec says | Brief or kickoff says | Reading I will take |
|---|---|---|---|
| C1 | `gates.yml` lives at factory `.github/workflows/gates.yml` | R-18: agents write only `ci/workflows/` | I write `ci/workflows/gates.yml`. `install-workflows.sh humyna-labs/factory` copies it to `.github/workflows/`. Product callers reference `humyna-labs/factory/.github/workflows/gates.yml@v1`, which works only after H-02 and after the human tags `v1`. |
| C2 | Reviewer runs on Codex (read-only sandbox) | Kickoff: the runner has `stub` and `claude` implementations only | The reviewer runs through the `claude` runner with read-only settings in Phase 1. A Codex runner goes to the backlog. Recorded as `Deviation: spec 3.3 reviewer model`. |
| C3 | Spec gates also include privacy e2e, licences and an asset registry | Kickoff: typecheck, lint, unit, e2e smoke, secret scan | Only the kickoff gates. The rest go to the backlog. |
| C4 | Spec lists `-w` (Claude creates the worktree) | Kickoff: "in a worktree" | The coordinator creates one `git worktree` per task and runs each role with that worktree as `cwd`. I do not use `-w`, because QA and Builder must share the same worktree and `-w` would give each session its own. Recorded as a deviation. |
| C5 | Spec 3.2: all roles live under `roles/` | Kickoff: only 4 complete role files | researcher, initializer, designer and gardener go to the backlog. |
| C6 | Spec: the bot "changes labels"; R-06: "changes labels only" | R-02: only the coordinator changes workflow labels | The bot (backlog) may only set command labels (`cmd:approve`, `cmd:reject`, `cmd:pause`). The coordinator reads them and is still the only writer of `factory:*` state labels. |
| C7 | R-04: "blocked actions are counted per run" | R-10: the `runs.csv` header is fixed and has no column for them | Blocked counts go to `/workspace/runs/events.jsonl` and into the queue digest, not into `runs.csv`. |
| C8 | Spec: the factory repo is read-only to agents | Kickoff: I build the factory | My writes reach `main` only through the PR (R-19), so they are consistent with the spec's intent. |

## 3. Ambiguities and the reading I will take

1. **"At most 3 implementation retries."** CORRECTED (section 9, item 3): 3 builder attempts in total (1 first attempt + 2 retries), configurable as `max_impl_attempts` in `factory.yaml`, default 3. A failure in verify, review or compliance sends the task back to `impl` and uses one retry from a single shared counter.
2. **Failure in the tests stage** (QA tests do not fail first, or are missing): escalate at once, with no retry. In the skeleton QA has no retry loop.
3. **Stage order.** Review and compliance run on the worktree branch diff before the PR exists, following the kickoff order. The `pr` stage pushes the branch, opens the PR, sets `risk:*`, then decides. Low risk: the coordinator merges (fake adapter) or runs `gh pr merge --auto --squash` (gh adapter), and the terminal state is `auto-merge`. High risk: label `factory:needs-human` and no merge.
4. **Risk.** It is the maximum of the issue label (`risk:high`/`risk:low`, default high if missing) and a deterministic check of the changed paths against `high_risk_paths` in `.factory/factory.yaml`. The merge function refuses high risk itself as a second line of defence.
5. **Rulesets versus auto-merge.** If `main` required one approval, low-risk PRs could never merge on their own. So `setup-repo.sh` requires a PR with 0 approvals plus code-owner review, and `CODEOWNERS` lists only high-risk paths. The result is that only high-risk paths need the human. (Spec 3.6 says this; I make it explicit.)
6. **Path of `runs.csv` in dry-run.** Real runs append to `/workspace/runs/runs.csv`. `--dry-run` appends to `/workspace/runs/dry-run/runs.csv` (same schema) so fake rows never pollute the real append-only ledger. Tests use temporary directories. The path can be overridden with `--runs-dir`.
7. **Reports from role sessions (R-20).** Each role session must write its report to `/workspace/runs/reports/<repo>-<issue>/<YYYY-MM-DD>-<repo>-<issue>-<stage>-<attempt>.md`. That path is outside git, on the shared mount, so the human can harvest it. The path guard allows each role to write exactly this one file, which is the only write a read-only role may make. After every session the coordinator checks the file exists and that sections 5 to 8 of the template are present and non-empty. If not, the stage fails. The R-21 `Stop` hook (backlog) will check the same file.
8. **Two writers per task?** QA writes `tests/` and `evals/` in the `tests` stage, and Builder writes `src/` in the `impl` stage, in the same worktree. They run one after the other and never at the same time, on disjoint paths. I read R-03 and P-08 as "one writer at a time per task". Reviewer and compliance are read-only.
9. **How the path guard works.** `hooks/path-guard.sh <role>` is a `PreToolUse` hook for `Edit|Write|MultiEdit|NotebookEdit|Bash`. It resolves the target path against the worktree root, rejects `..` escapes, absolute paths outside the worktree and symlink escapes, and applies per-role rules. For `Bash` it is conservative: it blocks any command that names a protected path for a role that may not write it. A second, stronger layer: after each session the coordinator runs `git diff --name-only` and feeds every changed path through the same `path-guard.sh`. Out-of-scope changes fail the stage. The bash script stays the single source of the policy.
10. **"The secret scan" in R-16.** There is no `gitleaks` binary in this image, so I cannot mutation-check gitleaks. I will build a small `hooks/secret-guard.sh` (spec 3.2 lists it) with named regex rules, tests and a mutation check. `gates.yml` runs both it and gitleaks (gitleaks binary pinned by checksum). The gitleaks part is "written, not run". Test fixtures build fake secrets at runtime by string concatenation, so no secret-shaped literal is ever committed (GitHub push protection would block it).
11. **Which env vars the code reads (R-05).** Exactly one module, `coordinator/src/env.ts`, touches `process.env`, with a named allowlist. A test fails if `process.env` appears anywhere else. Child processes get a built minimal environment (`PATH`, `HOME`, `LANG`, plus `GH_TOKEN` for `gh` only), never `{...process.env}`, plus `GIT_TERMINAL_PROMPT=0` and `GH_PROMPT_DISABLED=1` so nothing waits for input. For the bot (backlog), I assume its three variables are `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` and `GH_TOKEN`.
12. **Counting blocked actions.** Count `permission_denials` in the final `result` event of `stream-json`, plus the path-guard hook's own deny log (`/workspace/runs/guard.log`, which records the role, tool and path but never file contents). The field name is written from memory and is unverified until a real session runs.
13. **Queue mode.** Tasks are issues labelled `factory:ready`, ordered by `priority:p0..p3` and then by issue number. A task is "blocked" if it has the `factory:blocked` label or a `Depends-on: #N` line pointing at an open issue. `--max-hours` is checked before each task and each stage. If the deadline passes mid-task, the coordinator stops, keeps the current label (resumable), and lists the task in the digest as "stopped: time budget". The digest goes to stdout and to `/workspace/runs/digest-<UTC timestamp>.md`.
14. **`--dry-run` semantics.** It forces the fake GitHub adapter, the stub role runner and the stub gate runner, and loads three fixture tasks (low risk, high risk, always failing). For every role session it also prints the `claude` command that the claude runner would have assembled, so command assembly is visible without calling the CLI.
15. **`runs.csv` rows.** One row per stage execution (`outcome` pass or fail), plus one terminal row (`stage` = the terminal state's stage, `role=coordinator`, `outcome` in {auto-merge, needs-human, escalated}). The `task` value is `<repo>#<issue>`, never a title. `harness_fix` is checked to be one ASCII line of at most 200 characters, no email-like strings, CSV-quoted.
16. **Source of the `harness_fix` line.** The first entry of section 8 in the last role report if there is one, otherwise a deterministic template built from the failing stage and gate.
17. **Code owner handle.** I do not know the human's GitHub handle and will not guess it. Templates use a `{{CODE_OWNER}}` placeholder, filled in at generation time (see question 1).
18. **Model names.** Role files use the CLI aliases `sonnet`, `haiku` and `opus`, not dated IDs: qa=sonnet, builder=sonnet, reviewer=opus (CORRECTED, section 9 item 5), compliance=haiku. Upgrades go through the golden task (spec 3.7).
19. **`factory.yaml` schema.** The single source is a Zod schema in `coordinator/`. A committed JSON Schema at `templates/product/.factory/factory.schema.json` is generated from it, and a test fails if the two drift.
20. **Generating a product (A4).** A thin `coordinator new-product <name> --out <dir> --code-owner <handle>` that copies the template and fills placeholders. No GitHub calls. `factory new-product` with repo creation stays in the backlog (H-04 is human-only anyway).

## 4. Assumptions

- A1. Phase 1 makes no live GitHub calls. The only network use is the npm registry (for installs and for checking pinned versions with `npm view`) and, when I pin actions and gitleaks, read-only `gh api` lookups of tags, SHAs and checksums. Then come the final push and the PR. If any of these is blocked, I stop that step and report it (R-14).
- A2. Playwright browsers download from Microsoft or Playwright CDN hosts, which are probably not on the allowlist. I will try once with `npx playwright install chromium`. If the firewall blocks it, I record the domain and do not retry or use mirrors. The template's e2e then counts as "written, not run" here and runs in CI.
- A3. I cannot run anything under bash 3.2. Shell compatibility is checked statically: `bash -n`, plus a lint test that rejects bash-4-only constructs (`declare -A`, `mapfile`, `readarray`, `${x,,}`, `${x^^}`, `|&`, `&>>`, `coproc`), non-ASCII bytes, and `$VAR` followed by a non-ASCII character. Human scripts cannot rely on `timeout(1)` because macOS lacks it, so they use a pure-bash timeout helper.
- A4. Every version I pin is checked against the npm registry or the GitHub API on the day, and the report says how. Actions are pinned by commit SHA.
- A5. I set `git config core.hooksPath .githooks` locally in this clone so my own pushes pass through the R-07 hook. This is a local git setting, not a repo setting.
- A6. The human tags `factory` as `v1` after merging (agents push feature branches only, R-07). Until then, product CI callers cannot resolve `@v1`.
- A7. Commits carry both `Agent-Role: bootstrap` and the `Co-Authored-By` trailer required by my harness. Both are ASCII.
- A8. I add a one-line `CLAUDE.md` (`@AGENTS.md`) to the factory and the template so Claude Code sessions load the map. I also add `settings/reviewer.json` and `settings/compliance.json`, because the claude runner needs them for the two read-only roles. These are small additions beyond the kickoff list.
- A9. The workspace packages are `coordinator`, `hooks` (tests for path-guard, secret-guard and pre-push, plus the mutation checks), `scripts` (shell lint and `bash -n` for every `.sh`) and `evals`. `templates/product` is excluded from the workspace and checked by A4 in a temporary directory.

## 5. File tree I plan to create in Phase 1

```
AGENTS.md  CLAUDE.md  package.json  pnpm-workspace.yaml  tsconfig.base.json
eslint.config.js  .gitignore  .npmrc
.githooks/pre-push
docs/  failures.md  golden-principles.md  backlog.md  runbook.md
       playbook/README.md  adr/0001-skeleton-first.md
       design/readback-D2.md  design/trace-D2.md
       reports/2026-11-25-D2-phase1.md
coordinator/  package.json  tsconfig.json  vitest.config.ts
  src/cli.ts            run | run --queue | new-product, --dry-run
  src/env.ts            the only process.env reader
  src/state.ts          states, transitions, retry limit
  src/coordinator.ts    drives one task through the stages
  src/queue.ts  src/digest.ts  src/risk.ts  src/escalation.ts  src/report-check.ts
  src/runs-csv.ts       writer and validator
  src/events.ts         JSONL log
  src/config.ts         factory.yaml Zod schema
  src/new-product.ts
  src/runner/{types,stub,claude}.ts
  src/github/{types,fake,gh}.ts
  src/gates/{types,stub,shell}.ts
  src/workspace/{types,fake,git}.ts
  src/exec.ts           child processes with a minimal env and timeouts
  fixtures/dry-run-tasks.json
  test/*.test.ts        state machine, command assembly, merge path, runs.csv schema,
                        escalation, queue and digest, report check, env, code searches
roles/  qa.md  builder.md  reviewer.md  compliance.md
settings/  qa.json  builder.json  reviewer.json  compliance.json
hooks/  package.json  path-guard.sh  secret-guard.sh
        test/{path-guard,secret-guard,pre-push,mutation}.test.ts
scripts/  package.json  setup-repo.sh  install-workflows.sh  lib/common.sh
          test/shell-lint.test.ts
ci/workflows/gates.yml
templates/product/  package.json  index.html  vite.config.ts  tsconfig.json
  eslint.config.js  playwright.config.ts  AGENTS.md  CLAUDE.md  .gitignore
  src/{main.tsx,App.tsx}  tests/unit/App.test.tsx  tests/e2e/smoke.spec.ts
  public/_headers  .factory/factory.yaml  .factory/factory.schema.json
  .github/CODEOWNERS  ci/workflows/ci.yml  feature_list.json  progress.md
evals/  package.json  golden/001-low-risk-copy-change/{task.json,expected.json}
        golden/run.ts  test/golden.test.ts
```

No file under `.github/workflows/` anywhere.

## 6. Order of work (most important for acceptance first, in case I reach 80 turns)

1. Branch `factory/v1`. Scaffold the root workspace, TypeScript, ESLint, Vitest; check versions with `npm view`; get `pnpm install` and empty typecheck, lint and test green.
2. Coordinator core: state machine, `runs.csv` writer and schema test, fake GitHub, stub runner, stub gates, report check, escalation, queue, digest, `--dry-run` with the 3 fixture tasks (A2).
3. Claude runner command assembly and tests; gh adapter; git workspace; shell gates (written, unit-tested without the network).
4. `path-guard.sh`, `secret-guard.sh`, `.githooks/pre-push`, tests and mutation checks; settings files (A3).
5. Role files.
6. Product template, then generate into a temp dir and run typecheck, lint, unit and the Playwright attempt (A4).
7. `ci/workflows/gates.yml` and the template caller; human scripts and shell lint (A5).
8. Golden eval and runner.
9. Docs: AGENTS.md, ADR 0001, failures, golden principles, playbook, runbook (H-03, H-04), backlog (with R-06 and R-21).
10. Final A1 to A5 run, `trace-D2.md`, report, commits, push, PR.

Small commits after each step, each with an `Agent-Role: bootstrap` trailer.

## 7. What I will deliberately not build in Phase 1 (all go to `docs/backlog.md`)

- The Telegram command bot (R-06) and the Stop and SessionStart hooks (R-21).
- Roles: researcher, initializer, designer, gardener. A Codex reviewer runner.
- Gates: privacy e2e, licence check, asset registry, CSP/header gate in CI, screenshot capture, a CI workflow for the factory repo itself.
- Concurrency above 1 (the spec's global limit of 3), usage-based throttling, the GitHub-label resume loop beyond what one sequential pass needs, a long-running daemon.
- `factory new-product` with repo creation and labels, multi-product scheduling, gradual loosening of risk levels (spec 3.5 item 7), semantic version release automation and CHANGELOG.
- Any live run of `claude -p`, any live GitHub write except the final push and PR, the golden eval in claude mode, the runbook's pause/resume, rollback and token rotation sections, and automated `failures.md` entries.

## 8. Questions for the human (defaults apply if you just answer "Confirmed")

1. **Code owner handle** for `CODEOWNERS`: tell me your GitHub handle, or keep the `{{CODE_OWNER}}` placeholder that is filled when a product is generated. Default: the placeholder. The factory repo's own `CODEOWNERS` becomes a runbook step for you.
2. **Dry-run ledger**: dry-run rows go to `/workspace/runs/dry-run/runs.csv` (ambiguity 6). Default: yes. The alternative is the real `/workspace/runs/runs.csv`.
3. **Retry count**: 1 attempt plus 3 retries, so 4 builder runs (ambiguity 1). Default: yes. The alternative is 3 builder runs in total.

## 9. Corrections from the human (2026-11-25, accepted)

1. Code owner handle is `humyna`. It goes into the factory's own `CODEOWNERS` and is the default
   for `--code-owner` in `new-product`. The `{{CODE_OWNER}}` placeholder mechanism stays.
2. Dry-run ledger: `/workspace/runs/dry-run/runs.csv`.
3. Retries: 3 builder attempts in total (1 first attempt + 2 retries), shared counter across
   verify, review and compliance failures. Configurable as `max_impl_attempts` in
   `factory.yaml`, default 3. Reason: a builder run takes 20-40 minutes in a ~2 hour window,
   and per P-02 a repeated failure is a harness gap.
4. Exactly one minimal live `claude -p` call is allowed to verify flag parsing
   (`--permission-mode auto --model haiku --max-turns 1 --append-system-prompt-file <file>
   --output-format stream-json`). Record the result and the `permission_denials` field name if
   present. No other live claude calls in Phase 1.
5. Reviewer model is `opus` (qa=sonnet, builder=sonnet, compliance=haiku), so review uses a
   different model than the builder until the Codex runner exists. Recorded as a deviation from
   the spec in ADR 0001.
6. Rulesets: it is not certain that "0 approvals + require code owner review" enforces
   code-owner approval. `docs/runbook.md` gets an H-01 verification step (a test PR touching only
   a high-risk path must not merge without the human's approval). Fallback: GitHub's "required
   reviewer" ruleset rule (path patterns, needs a team containing the human). `setup-repo.sh`
   offers both as options.
7. Playwright: if the browser download is blocked, record the exact domains in section 4 of the
   report and stop that step. No alternatives.
8. Human steps in the final report include: tag factory `v1` after merging the PR.
