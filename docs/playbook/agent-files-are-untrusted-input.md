# Agent-written files are untrusted input to human-run scripts

When: any script a human runs with stronger credentials than the agent has (owner token,
host shell) and that reads a file the agent can write: workflow sources, label lists, config,
the scripts themselves.

How:
- Refuse symlinks before reading anything: on a bind mount they resolve on the host, so a copy or
  diff can leak a host file (W2-02 A1, W2-03).
- Validate every field that becomes an argument, a URL or an API path (allowlist characters, no
  leading `-`); never interpolate it unchecked (A4, E1).
- Resolve where a push really goes (`git remote get-url --push` applies `insteadOf` and
  `pushInsteadOf`) and compare it with the expected URL.
- Read first, show the plan and the full diff, require a typed `yes`, then mutate; record each
  remote change so a failure says what already happened (A2, A3, A5).
- Run the script from a separate reviewed clone the agent cannot write (E2).
- Put each check in a marked guard function with cases and a mutation check (G-03).

Evidence: `scripts/lib/guards.sh` G1 to G12, `scripts/test/guards.test.ts` (cases),
`guards-mutation.test.ts` (12 of 12 guards caught), `flows.test.ts` (offline flows with a fake gh).
