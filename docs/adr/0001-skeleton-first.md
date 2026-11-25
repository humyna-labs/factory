# ADR 0001: Walking skeleton first

- Status: proposed (D2 Phase 1, pull request to `main` for the human)
- Date: 2026-11-25
- Principles: P-01, P-02, P-03, P-05, P-06, P-07, P-08, P-11, G-01, G-03, G-04, G-07

## Context

The spec (`docs/design/factory-spec.md`) describes eight roles, a Telegram bot, rich gates and
multi-product scheduling. Brief D2 (R-01) asks for one thin path from issue to merged pull
request first, with stub stages where needed.

## Decision

1. Build the full state machine and every interface now, with the thinnest implementations:
   stub roles and fake GitHub for the dry run; claude runner and gh adapter written and
   unit-tested for command assembly (P-01: known flow is deterministic code).
2. The coordinator alone merges and changes state labels (R-02, P-11). It reaches merge only
   through `coordinator/src/merge.ts`, which refuses high risk.
3. One worktree per task, created by the coordinator. QA and builder write there one after the
   other on disjoint paths; reviewer and compliance are read-only (P-08). The policy lives once,
   in `hooks/path-guard.sh`, which is used both as a PreToolUse hook and as the post-session
   check of every changed path (P-05, G-02).
4. Three builder attempts in total, configurable as `max_impl_attempts`; then escalate with a
   harness-fix issue (P-02, human correction in the read-back).
5. Sequential execution (concurrency 1) in Phase 1 (P-07).
6. Every guard is mutation-checked (G-03). Every human step is a script with `--dry-run` that
   refuses to run in the container (G-04, G-07).

## Deviations

- Deviation: spec 3.3 names Codex as the reviewer. The reviewer runs through the claude runner
  on `opus` (builder is `sonnet`) so review uses a different model. Reason: no Codex runner yet.
  Revisit when the Codex runner (backlog) exists.
- Deviation: spec 3.2 lists `-w` (Claude creates the worktree). The coordinator creates the
  worktree instead, because QA and builder must share it. Revisit if Claude Code can attach
  sessions to an existing worktree by name.
- Deviation: spec 3.4 global concurrency 3. Phase 1 runs one task at a time. Revisit with the
  concurrency backlog item after the first live week (P-07).
- Deviation: R-04 says the bypass flag appears nowhere; three human-owned design docs quote it.
  The test exempts exactly those files. Revisit when the human rewords them.
- Blocked-action counts go to `events.jsonl` and the digest, because the `runs.csv` header is
  fixed (R-10). Revisit if the human adds a column to the contract.

## Consequences

- A2 runs end to end locally in under a second; the live path is written but not run.
- Adding a role or gate means a new role file, settings file and path-guard rules plus their
  cases; the mutation test fails until the new rules have cases.
