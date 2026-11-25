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
