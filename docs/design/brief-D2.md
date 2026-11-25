# Factory brief D2: requirements from day 1

Audience: the agent building the factory. This brief carries the decisions and lessons of
2026-11-24 that are not in `factory-spec.md`. Where this brief and the spec disagree, this
brief wins; say so in your read-back. The spec is the target design; the walking skeleton
in `kickoff-D2.md` is the first step toward it.

## 1. Environment you are running in

- A Docker container: non-root user, no capabilities, default-deny firewall with an
  allowlist (Anthropic, npm, GitHub, Telegram, Codex). `/workspace` is the only shared
  directory. There is no other network access; do not try to obtain it.
- Repositories live in the GitHub organization `humyna-labs`: `factory` (this one),
  `resume-sg`, `condo-demo`. All public.
- Git identity and GitHub token belong to a machine account. The token can write contents,
  pull requests and issues on those repositories. It cannot create repositories, change
  repository settings or rulesets, or push files under `.github/workflows/`.
- The human checks in three times per weekday (morning, midday, evening) and is away in
  between. Unattended windows are about 2 hours, 2.5 hours and 10 hours (overnight).
  A task queued for a window must finish or fail on its own: it never asks a question
  and never waits for confirmation.

## 2. Requirements

Each requirement has an ID and a reason. Your read-back restates each one; your final report
traces each one to files and to a verification.

| ID | Requirement | Verify by |
|---|---|---|
| R-01 | Walking skeleton first: one thin path from issue to merged pull request, with stub stages where needed, before any stage is made rich. | Dry-run acceptance in the kickoff |
| R-02 | Only the deterministic coordinator merges pull requests and changes workflow labels. No LLM session merges anything. (Claude Code auto mode also blocks merging a pull request that no human approved.) | Code search; unit test on the merge path |
| R-03 | One writing agent per task, in its own worktree. Other roles are read-only. Enforced by a path guard, not by instructions alone. | Path-guard tests |
| R-04 | Every agent session the factory starts uses `--permission-mode auto` (headless `claude -p` needs the flag explicitly). `--dangerously-skip-permissions` appears nowhere in this repository. Blocked actions are counted per run. | Grep; unit test on command assembly |
| R-05 | Code reads only the environment variables it needs, never prints or logs the environment, and never reads another process's environment. The command bot reads exactly its three variables and is built to run as a separate service. | Code search; unit test |
| R-06 | Command bot (not part of the skeleton; keep in the backlog): private chats only, `from.id` must equal `TELEGRAM_ALLOWED_USER_ID`, everything else is dropped silently and logged. Acceptance includes a stranger test with fake updates. It changes labels only and never merges high-risk pull requests. | Backlog entry with these acceptance criteria |
| R-07 | Commits are authored by the machine account, are small, have ASCII messages and an `Agent-Role:` trailer. Agents push feature branches only, never `main`. A pre-push hook rejects any remote whose owner is not `humyna-labs`. | Hook test |
| R-08 | Anything a human must run is a script: one command, idempotent, self-checking, with timeouts on network calls, working under macOS bash 3.2, with `--dry-run`. Shell messages are ASCII; if non-ASCII is unavoidable, variables are written `${VAR}`. | `bash -n`; a lint test for the variable rule |
| R-09 | Every escalation writes a `runs.csv` row with `escalated=true` and a one-line `harness_fix`, and drafts a GitHub issue labelled `harness-fix` with context, reproduction, expected behaviour, proposed change and acceptance criteria. | Dry-run acceptance |
| R-10 | `runs.csv` contract: path `/workspace/runs/runs.csv`; header exactly `task,stage,role,start,end,turns,cost,outcome,escalated,harness_fix`; timestamps ISO 8601 in UTC; `outcome` is one of `pass`, `fail`, `auto-merge`, `needs-human`, `escalated`; `escalated` is `true` or `false`; no personal data; append-only. | Schema test |
| R-11 | `docs/principles.md` is the reference for design decisions. Follow its "How to use this file" rules: cite principle IDs in ADRs and harness-fix pull requests, record deviations, keep `docs/failures.md`, add reusable practices to `docs/playbook/`. | Files exist; ADR 0001 cites principles |
| R-12 | Queue mode for unattended windows: `coordinator run --queue --max-hours N` takes ready tasks in priority order, never waits for input, skips blocked tasks, and ends with a digest: done, needs human, escalated, blocked actions, cost. | Dry-run acceptance |
| R-13 | Deployment uses Cloudflare Pages Git integration. No Cloudflare credential exists in the container; do not ask for one. | No code references a Cloudflare token |
| R-14 | If the firewall blocks a domain, record the domain and the step in the report and stop that step. Do not look for mirrors or workarounds. | Report |
| R-15 | Reports separate "verified by running" from "written, not run". "All checks pass" is never stated for something that was not executed. | Final report format |
| R-16 | Guards are mutation-checked: for the path guard and the secret scan, break each rule in a scratch copy and confirm a test fails. | Test log |
| R-17 | Handoff protocol: read-back before building; trace matrix at the end (`docs/design/trace-D2.md`). | Files exist |
| R-18 | Workflow files are high risk. Agents write them under `ci/workflows/`, never under `.github/workflows/`. A human-run script installs them after review. | Grep; script exists |
| R-19 | Changes to the factory itself always reach `main` through a pull request reviewed by the human. | Branch and pull request |
| R-20 | Every run ends with a report at `docs/reports/YYYY-MM-DD-<handoff ID>.md` written from `docs/templates/run-report.md`. Sections 5 to 8 (surprises, reusable practices, proposed principle changes, proposed harness fixes) are mandatory; write "none" only if truly none. The human harvests these files into a private knowledge base, so write for a reader who was not there, and include no secrets or personal data. The factory itself must also make every role session it runs produce such a report. | The report file exists; a unit test checks the coordinator requires it |
| R-21 | Put two hook-based items in the backlog with acceptance criteria (do not build them in Phase 1): a `Stop` hook that blocks a session from ending while its report is missing (Claude Code hooks can block stopping with exit code 2 or `{"decision":"block","reason":...}`), and a `SessionStart` hook that injects `progress.md` and open escalations as context at the start of every session. | Backlog entries |

## 3. Steps only the human can do (provide a script for each; do not attempt them)

| ID | Step | Script |
|---|---|---|
| H-01 | Configure rulesets on a repository: require pull requests and status checks on `main`, block force pushes, enable auto-merge, create labels | `scripts/setup-repo.sh <owner/repo>` |
| H-02 | Install reviewed workflow files from `ci/workflows/` into `.github/workflows/` and push | `scripts/install-workflows.sh <owner/repo>` |
| H-03 | Connect a product repository to Cloudflare Pages | Documented in `docs/runbook.md` (dashboard steps) |
| H-04 | Create a new repository in the organization | Documented in `docs/runbook.md` |

## 4. Known pitfalls from day 1

- A report that says "all acceptance checks pass" about files that were never built or run
  misleads the human. See R-15.
- Long pasted instructions were truncated once and requirements were lost. That is why
  instructions now arrive as files and why the read-back exists.
- macOS bash reads a full-width character directly after `$VAR` as part of the variable
  name. See R-08.
- Pinned versions written from memory were out of date. When you pin a version, say
  whether you verified it and how.
