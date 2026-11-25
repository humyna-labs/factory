# Fakes store what the real service stores, not what they were sent

When: a test drives a script through a fake API (fake `gh`) and the script reads its writes back.

How:
- A fake that echoes every request body back makes a read-back test unable to fail on a wrong field
  name or value; it only proves the script agrees with itself (verifier P4).
- After the first real run, encode every normalization the service did into the fake (GitHub stores
  the OrganizationAdmin bypass actor with `actor_id` null), and add a scenario that the real script passes
  with it.
- Keep at least one corruption per compared field in the fake (`corrupt` modes) so the read-back is
  shown to fail when the service really differs.
- Mark fields that were never run against the service as "written from memory" until a real read-back
  has matched them.

Evidence: `docs/failures.md` 2026-11-25 (null actor id); `scripts/test/fake/gh` (`store_ruleset`,
`corrupt` modes); `scripts/test/flow-kit.ts` S1 scenarios; flows-mutation CHECK S1 and S1-weak.
Principles: G-01, G-02, G-03.
