# Golden principles

Seeded from Section B of `docs/principles.md` on 2026-11-25. This file grows from notes in
`docs/playbook/` (rule 4 of "How to use this file"). Changes to Section A of the principles file
are proposals for the human, never edits.

| ID | Principle | Evidence from day 1 | How the factory enforces it (D2) |
|---|---|---|---|
| G-01 | An acceptance check proves only what it ran | The first container report said all checks passed while nothing had been built or run. | Reports and `docs/design/trace-D2.md` mark every claim "verified by running" or "written, not run". |
| G-02 | Verify agent claims independently | The Telegram plugin said the allowlist was locked; a second account confirmed it. | The coordinator re-runs gates itself (`verify`) and re-checks every changed path with `path-guard.sh` after each session. |
| G-03 | Test the tests on every guard | 4 of 11 first-round mutations had never been applied. | `hooks/test/mutation.test.ts` disables each guard rule and requires a failing case; the shell lint has its own tests. |
| G-04 | Human steps need a harness too | Over half the day-1 interventions came from manual steps. | `scripts/setup-repo.sh`, `scripts/install-workflows.sh`: one command, `--dry-run`, self-check, timeouts. |
| G-05 | A guardrail block is a stop sign | A safety check refused a delete; the agent reported it. | Role prompts and `AGENTS.md`: record blocks, never route around them. |
| G-06 | Host software versions are part of the isolation boundary | An outdated Docker Desktop would have voided every container control. | Out of scope for this repo (host preflight); pinned tool versions are recorded with how they were verified. |
| G-07 | Where a command runs is part of the command | A channel was nearly opened on the host instead of the container. | Human scripts refuse to run inside the container (`require_host` in `scripts/lib/common.sh`). |
