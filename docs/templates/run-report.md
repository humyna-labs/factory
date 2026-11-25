# Run report <YYYY-MM-DD> <handoff ID>: <title>

<!--
Written by the agent at the end of every handoff, at docs/reports/<YYYY-MM-DD>-<handoff ID>.md.
The human harvests these files into the private playbook, so write for a reader who was not there.
No secrets, no personal data. Keep it under about 150 lines; link to files instead of pasting them.
-->

## 1. Outcome
Done / partly done / blocked, in one or two sentences.

## 2. Acceptance
| Check | Result | Verified by running, or written, not run |
|---|---|---|

## 3. Trace
| Requirement | Files | How verified |
|---|---|---|

## 4. Blocks and human help
- Actions blocked by permissions, hooks or the firewall (what, why, what you did instead)
- Points where you needed the human, and what capability would have avoided it

## 5. Surprises
What did not behave as expected (tools, docs, environment, your own assumptions), and what you
learned from it. This is the most valuable section: be specific.

## 6. Reusable practices
Practices worth reusing in other tasks or products. For each: when to use it, how, evidence.

## 7. Proposed principle changes
| Principle ID (P-xx, G-xx or new) | Proposal | Evidence |
|---|---|---|

## 8. Proposed harness fixes
| Problem | Fix (role prompt, hook, test, gate, doc) | Size | Risk |
|---|---|---|---|

## 9. Cost
Turns, wall-clock time, and any usage or budget figures available.

## 10. Open questions for the human
At most three, each with options and your recommendation.
