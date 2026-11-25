# Handoff <ID>: <title>

<!--
Template for every instruction given to an agent. The coach writes it; the human saves it as a file
in the target repo and starts the agent with one line: "Read <path> and follow it exactly."
Keep it tight: put stable context in the repo (AGENTS.md, docs/), and only the delta here.
-->

## 1. Goal and why
One paragraph: what done looks like, and why it matters for the owner's goal.

## 2. Read first
- `docs/principles.md` (always)
- <other files the agent must read before Phase 0>

## 3. Verified facts (treat as given)
| ID | Fact | Verified how, when |
|---|---|---|
| F1 | | |

## 4. Requirements
| ID | Requirement | Why | Verify by |
|---|---|---|---|
| R-01 | | | |

## 5. Constraints
- Where you may write; what you must not touch; network and secret rules.
- If a safety check blocks you, report it and stop that step. Do not route around it.

## 6. Out of scope
- <things the agent should not build now; put them in the backlog>

## 7. Human-only steps
| ID | Step | Provide |
|---|---|---|
| H-01 | | a script with --dry-run |

## 8. Phase 0: read-back (then stop)
Write `<readback path>`: each requirement in your own words; ambiguities and conflicts with the
reading you intend to take; assumptions; the plan of files and order; what you will not build.
Stop and wait for "Confirmed".

## 9. Stop conditions
- Stop after <N> turns and report where you are.
- Stop if <condition>.

## 10. Final report (part of the deliverable)
Write `docs/reports/<YYYY-MM-DD>-<ID>.md` using `docs/templates/run-report.md`. The run is not done
until this file exists. Mark every claim "verified by running" or "written, not run".
