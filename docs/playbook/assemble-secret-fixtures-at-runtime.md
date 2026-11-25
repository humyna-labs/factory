# Assemble secret-shaped test fixtures at runtime

- When: testing a secret scanner, a hook that blocks secrets, or anything that needs
  token-shaped strings.
- How: build the sample from pieces in code (`"ghp" + "_" + "a1B2".repeat(9)`), never as one
  literal. Write the scanner's own regexes so that they do not match themselves.
- Evidence: `hooks/test/cases.ts`; `hooks/secret-guard.sh --scan-git` and gitleaks 8.30.1 both
  report the factory repository clean (2026-11-25), so CI secret gates and GitHub push
  protection will not trip on our own tests.
- Principles: G-03.
