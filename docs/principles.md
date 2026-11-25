# Factory principles

This file is the reference every agent and every design decision in the factory must use.
It is curated by the human on the host (agents in the container have no web access) and
re-checked against the sources at least every quarter. Summaries are in our own words;
read the sources for detail.

## How to use this file (rules)

1. Every ADR, every harness-fix PR and every role or gate change cites the principle IDs it
   applies, for example `Principles: P-02, P-11`.
2. A deliberate deviation is allowed, but it must be recorded in the same ADR or PR as
   `Deviation: P-xx, reason, when to revisit`.
3. Every failure that needed a human goes into `docs/failures.md` with: symptom, root cause,
   the principle it relates to, the fix, and links to the issue and PR.
4. When the same failure class is solved, add one short note to `docs/playbook/` describing
   the reusable practice. Section B below grows from those notes.
5. The gardener role checks for drift: decisions without principle IDs, failures without a
   fix, and principles nobody has cited in 30 days (candidates for removal or rewording).
6. Agents never edit Section A. Proposals to change it go in a PR for the human.

## Section A: principles from published practice

| ID | Principle | What it means here | Source |
|---|---|---|---|
| P-01 | Use the simplest thing that works | Known flow is deterministic code (the coordinator). Agents work inside steps only. | [1] [2] |
| P-02 | Humans steer, agents execute | When an agent fails, add the missing capability (tool, guardrail, document). Do not do its work for it and do not just retry. Every escalation opens a harness-fix issue. | [3] |
| P-03 | Give agents a map, not a manual | `AGENTS.md` stays near 100 lines and points into `docs/`, which is the system of record. | [3] |
| P-04 | Make the application legible to agents | Each worktree can start the app. Verification uses a real browser and keeps screenshots. | [3] [4] |
| P-05 | Enforce architecture and taste mechanically | Custom lint rules and structural tests, with the remediation written into the error message. | [3] |
| P-06 | Long-running work needs a harness | An initializer writes the feature list. Only the verify stage may mark a feature as passing. One feature per session. State lives in a progress file and git. | [4] |
| P-07 | Use multiple agents sparingly | Coding parallelizes poorly and multi-agent runs cost far more tokens than a single agent. Add agents only where the work is truly independent. | [5] [6] |
| P-08 | One writer, shared context | One writing agent per task. Other roles read and judge. | [6] |
| P-09 | Delegate explicitly | Every delegation states objective, output format, tools and boundaries. Effort scales with task size (S/M/L). | [5] |
| P-10 | Evaluate early with small samples | About 20 cases, a rubric-based LLM judge, judged on end state, plus human testing. | [5] |
| P-11 | Layer the guardrails by risk | Risk-rate tools and paths. Hand off to a human on high risk or repeated failure. | [2] |
| P-12 | Clean up entropy continuously | Write down golden principles. A background agent opens small cleanup PRs. | [3] |

Counter-example to remember: the "few gates, fix forward" style in [3] assumes agent output
far exceeds human attention and that mistakes are cheap. This factory handles personal data,
so privacy and security paths keep strict gates.

Sources:

- [1] Anthropic, Building effective agents: https://www.anthropic.com/research/building-effective-agents
- [2] OpenAI, A practical guide to building agents: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- [3] OpenAI, Harness engineering: https://openai.com/index/harness-engineering/
- [4] Anthropic, Effective harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [5] Anthropic, How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- [6] Cognition, Don't build multi-agents: https://cognition.ai/blog/dont-build-multi-agents

## Section B: our own golden principles (seeded from day 1, grows over time)

| ID | Principle | Evidence from day 1 |
|---|---|---|
| G-01 | An acceptance check proves only what it ran | The first container report said all checks passed while nothing had been built or run. Reports must separate "verified by running" from "written, not run". |
| G-02 | Verify agent claims independently | The Telegram plugin said the allowlist was locked. A second account was still used to confirm it. |
| G-03 | Test the tests on every guard | Breaking each guard on purpose showed that 4 of 11 first-round mutations had never been applied. |
| G-04 | Human steps need a harness too | More than half of the day-1 interventions came from manual steps: multi-line pastes, the wrong terminal, hidden characters. Human steps become single-command, self-checking scripts. |
| G-05 | A guardrail block is a stop sign | When a safety check refused a delete, the agent reported it and did not route around it. |
| G-06 | Host software versions are part of the isolation boundary | An outdated Docker Desktop would have voided every container control. Versions are gated in preflight. |
| G-07 | Where a command runs is part of the command | A channel was nearly opened on the host instead of the container. Location-sensitive actions are wrapped in scripts that enforce the location. |
