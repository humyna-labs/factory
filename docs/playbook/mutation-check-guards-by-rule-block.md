# Mutation-check guards by rule block

- When: writing or changing a guard script (path guard, secret guard, lint).
- How: wrap each rule in `# RULE <id> begin` / `# RULE <id> end`. Keep the cases in one table.
  The mutation test removes one block at a time in a scratch copy and requires at least one case
  to fail. Assert the deciding rule id, not only allow/deny, and log whether the decision itself
  flipped: a rule that only changes the rule id is shadowed by a later default deny. That is fine
  as defence in depth, but say so.
- Evidence: `hooks/test/mutation.test.ts`, 2026-11-25: 23 of 23 mutations caught; R2, R8 and R9
  are shadowed (decision unchanged, rule id changed).
- Principles: G-03, P-05.
