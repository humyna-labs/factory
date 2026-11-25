# Pin versions from the registry, not from memory

- When: writing any dependency, action or tool version.
- How: `npm view <pkg> version` and `npm view <pkg>@<v> peerDependencies`; for actions,
  `gh api repos/<owner>/<action>/releases/latest --jq .tag_name` then
  `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`; for binaries, the release checksums file.
  Write in a comment how and when the pin was verified.
- Evidence: brief D2 section 4 (pins written from memory were out of date). On 2026-11-25 the
  latest TypeScript was 7.0.2, but typescript-eslint 8.74.0 accepts only `<6.1.0`; reading peer
  ranges avoided a broken lint setup. TypeScript is pinned to 6.0.3.
- Principles: G-01, P-05.
