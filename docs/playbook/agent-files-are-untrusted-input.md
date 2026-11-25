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
- Refuse every byte outside printable ASCII, tab and newline in files the owner must read, and show
  them through an escaped view that ignores diff attributes (`--text --no-ext-diff | cat -v`): control
  bytes can erase lines from the terminal (verifier P2).
- When a check is line-based, refuse the token anywhere (block scalars, comments) and refuse the
  syntax that could build it without spelling it (YAML escapes, joined lines), instead of parsing.
- Read first, show the plan and the full diff, require `yes` typed at a terminal (`[ -t 0 ]`), then
  mutate; record each remote change as it happens, and a timed-out one as "outcome unknown" (A2, A3, A5, P5).
- Push exactly what was shown: compare the commit's tree and parent with the previewed tree and base.
- Run the script from a separate reviewed clone the agent cannot write (E2), and check the location
  before sourcing anything or running git there (Codex 1).
- Put each check in a marked guard function with cases and a mutation check (G-03).

Evidence: `scripts/lib/guards.sh` G1 to G20, `scripts/test/guard-cases.ts` (cases),
`guards-mutation.test.ts` (every guard caught), `flow-kit.ts` and `flows.test.ts` (offline flows
with a fake gh, under a real terminal), `flows-mutation.test.ts` (every CHECK block in the entry scripts).
