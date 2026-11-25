# Factory: map for agents

This repository is the agent factory (humyna-labs/factory). This file is a map, not a manual
(P-03). `docs/` is the system of record. Read `docs/principles.md` before any design decision
and cite principle IDs (P-xx, G-xx) in ADRs and harness-fix pull requests.

## What the factory does

One task (a GitHub issue in a product repo) travels a fixed path, driven by deterministic code:

```
ready -> tests -> impl -> verify -> review -> compliance -> pr -> auto-merge | needs-human | escalated
```

- `tests`: the QA role writes failing tests. `impl`: the builder makes them pass.
- `verify`: the coordinator re-runs the gates itself. `review`, `compliance`: read-only roles judge.
- `pr`: the coordinator opens the PR, rates risk, merges low risk, routes high risk to the human.
- Any failure goes back to `impl`. After `max_impl_attempts` builder runs (default 3) the task
  escalates, writes an escalated `runs.csv` row and drafts a `harness-fix` issue (P-02).

## Where things are

| Path | What | Read |
|---|---|---|
| `coordinator/` | TypeScript state machine and CLI (`bin/coordinator`) | `coordinator/src/coordinator.ts`, `state.ts` |
| `coordinator/src/runner/` | role runners: `stub` (deterministic) and `claude` (headless) | `claude.ts` for the exact flags |
| `coordinator/src/github/` | GitHub adapters: `fake` (memory) and `gh` (CLI) | `types.ts` |
| `coordinator/src/merge.ts` | the only merge path (R-02) | |
| `coordinator/src/runs-csv.ts` | the `runs.csv` contract (R-10) | |
| `roles/` | role prompts with front matter (model, limits, settings) | one file per role |
| `settings/` | Claude Code settings per role: deny rules and hooks | |
| `hooks/path-guard.sh` | per-role write policy, used as hook and post-session check (R-03) | rule ids R1-R9, B1-B6 |
| `hooks/secret-guard.sh` | secret scanner, hook and CI gate | rule ids S1-S8 |
| `.githooks/pre-push` | owner, branch, ASCII and trailer checks for pushes (R-07) | |
| `templates/product/` | product template (Vite, React, TS, Playwright, CSP, factory.yaml) | its `AGENTS.md` |
| `ci/workflows/` | workflow sources (R-18). Never write `.github/workflows/` | `gates.yml` |
| `scripts/` | human-run scripts with `--dry-run` (R-08) | `docs/runbook.md` |
| `evals/golden/` | golden tasks with expected end states | `run.ts` |
| `docs/` | principles, ADRs, runbook, backlog, failures, playbook, reports | below |

## Docs

- `docs/principles.md`: P-01..P-12 (Section A, human-only) and G-xx (Section B).
- `docs/golden-principles.md`: our own principles, seeded from Section B; grows from the playbook.
- `docs/adr/`: decisions. Each cites principle IDs and records deviations.
- `docs/runbook.md`: human steps H-01..H-04 and how to check things.
- `docs/backlog.md`: what is not built yet, ordered for unattended windows.
- `docs/failures.md`: every failure that needed a human.
- `docs/playbook/`: reusable practices, one short note per solved failure class.
- `docs/design/`: spec, brief, kickoff, read-back and trace for each handoff.
- `docs/reports/`: one run report per handoff, from `docs/templates/run-report.md`.

## Commands

```
pnpm install
pnpm -r typecheck && pnpm -r lint && pnpm -r test   # all checks
bin/coordinator --dry-run --verbose                  # A2: stub roles, fake GitHub, local git
bin/coordinator validate-runs /workspace/runs/dry-run/runs.csv
bin/coordinator new-product <name> --out <dir>       # code owner defaults to humyna
node evals/golden/run.ts                             # golden tasks (stub runner)
```

Node 22.18 or later runs the TypeScript sources directly (type stripping); there is no build.

## Rules that are enforced mechanically

- Only the coordinator merges and changes `factory:*` labels (R-02). Roles never get the
  GitHub adapter; settings deny `gh`, `git push`, `git commit`.
- Every role session uses `--permission-mode auto` (R-04). The bypass flag appears nowhere.
- Each role writes only its own paths; `path-guard.sh` blocks the rest during the session and
  the coordinator re-checks every changed path afterwards (R-03).
- `process.env` is read only in `coordinator/src/env.ts`; child processes get a minimal env (R-05).
- Every role session leaves a report; a missing report fails the stage (R-20).
- `runs.csv` is append-only with a fixed header (R-10).
- Commits are small, ASCII, authored by the machine account, with an `Agent-Role:` trailer;
  pushes go to `humyna-labs` feature branches only (R-07). Enable with
  `git config core.hooksPath .githooks`.

## When you are blocked

A blocked action (hook, auto mode, firewall) is a stop sign (G-05, R-14). Do not route around
it. Record what, where and why in your report, and propose the missing capability (P-02).
Never claim a check passed unless you ran it (G-01, R-15).

## Changing the factory

Changes reach `main` only through a pull request the human reviews (R-19). Run the golden
tasks before changing a role prompt, the coordinator, or the Claude Code version (spec 3.7).
