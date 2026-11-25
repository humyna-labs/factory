# ADR 0002: Permission model for the machine account, rulesets and merges

- Status: **accepted, option (b)**, 2026-11-25 (the owner applied it on both repositories that evening;
  recorded by handoff D2-night)
- Date: proposed and accepted 2026-11-25
- Principles: P-02, P-08, P-11, G-01, G-02, G-04, G-07, R-02, R-07, R-18, R-19
- API fields: written from memory in D2-W2, then checked by the first real `setup-repo.sh` run
  (section "Evidence"). Every field read back as written except the OrganizationAdmin `actor_id`, which
  GitHub stores as null. v1.2 compares that actor by type and mode only.

## Evidence (2026-11-25, run by the owner on the host; facts from handoff D2-night)

- `setup-repo.sh humyna-labs/factory --profile factory --owner-bypass` and the product run for
  `humyna-labs/resume-sg`: the read-back failed on one field in both, `bypass_actors`: expected
  `OrganizationAdmin:1:pull_request`, GitHub returned `OrganizationAdmin:null:pull_request`. Every earlier
  field matched, including the five product status checks and `strict_required_status_checks_policy`.
  So the merge settings, `actions/permissions/workflow`, the labels, the ruleset name, target, enforcement,
  include pattern, rule types and pull-request parameters are as written here. The organization-membership
  lookup let `--owner-bypass` through (G11), so it returned `member`.
- The API returns `current_user_can_bypass: "pull_requests_only"` for the owner, and the bypass checkbox
  appeared on the PR page: the bypass works with `actor_id` null. Factory PR #3 (`gates.yml`) and the
  resume-sg workflow install PR were merged through it (the latter only after all five checks were green).
- H-01 on resume-sg with PRs opened by `humyna-bot`: #2 (only `public/_headers`) was
  `REVIEW_REQUIRED`/`BLOCKED`, and the bot's `gh pr merge` was refused; after the owner's approval it became
  mergeable. #3 (only `src/App.tsx`) was `CLEAN` with no review. Both were closed and their branches deleted.
- F1 had another cause than the one assumed below: the bot's fine-grained token had been "pending
  organization approval" since it was created, so it could reach nothing. The owner approved it with
  repositories `factory` and `resume-sg` only; Contents, Pull requests and Issues read and write; Checks,
  Commit statuses and Actions read; nothing else (`docs/failures.md`).

## Context

- F1: pushing `factory/v1` as `humyna-bot` failed with 403. This ADR assumed that the token lacked write
  access; the real cause was that the token was still pending organization approval (Evidence). Spec 3.6 says "the factory repo is read-only to agents". Brief D2 says the token can write
  contents, PRs and issues. The coach wrote both, so the two conflict.
- Review findings A3 and A5: `setup-repo.sh` replaced the ruleset blindly, the factory profile had no
  approval rule, the product profile let a branch that is behind its base pass, and the read-back checked almost nothing.
- Deadlock: once an approval rule is on, every PR that the owner opens is stuck, because an author cannot
  approve his own PR. `install-workflows.sh` opens its PR with the owner's credentials. On products that PR
  touches `.github/workflows/`, a code-owner path whose only code owner is the owner. It is not limited
  to `factory/v1`.

## Decision

1. **Machine account.** `humyna-bot` gets write access to contents, pull requests and issues on the
   factory repository and on every product repository, through its fine-grained token (as approved on
   2026-11-25), and nothing that changes settings, workflows or secrets. It needs that to push feature branches and open PRs. It never merges on the factory, and it
   merges only low-risk PRs on products, through `coordinator/src/merge.ts` (R-02).
   `Deviation: spec 3.6 "factory read-only to agents"`. Reason: the agent cannot otherwise deliver
   factory changes as PRs (R-19). The rulesets below protect `main` instead of read-only access. Revisit when a
   GitHub App with narrower permissions replaces the token.
   The bot must be an organization **member**, never an admin (it matters for option b).
2. **Every `main` is protected by the `factory-main` ruleset**: no deletion, no force push, PR
   required, stale reviews dismissed. `setup-repo.sh` prints the existing ruleset next to the new one and
   needs a typed `yes` before it writes. It then reads every field back.
3. **Factory profile:** 1 required approval plus code-owner review, with `CODEOWNERS` set to `* @humyna`. Required status
   checks are added with `--require-checks "<context>,..."` once factory CI exists (BL-16).
   Auto-merge off.
4. **Product profile:** 0 approvals plus code-owner review. `CODEOWNERS` lists only the high-risk
   paths, so a low-risk PR can auto-merge and a high-risk one needs the owner. The five `gates / ...` checks are
   required, and the branch must be up to date with its base (`strict_required_status_checks_policy: true`).
5. **Default workflow token permissions are read-only** on every repository, and workflows cannot approve
   PRs (`setup-repo.sh`). `install-workflows.sh` refuses any workflow without a top-level
   `permissions:` block, and any workflow that asks for a write scope not on its (empty) allowlist.
6. **Merge method per profile:**
   - Factory: merge commits and squash allowed, rebase off. Merge commits keep each commit's `Agent-Role:`
     trailer on `main` (R-07).
   - Products: squash only, with the PR title and the coordinator's trailer in the squash message.
7. **The deadlock:** option (b), chosen and applied on 2026-11-25. Option (a) stays below for the record.

## Options for the deadlock

### (a) Order only, no bypass

Merge `factory/v1` and `factory/v1.1`, run `install-workflows.sh` and merge its PR, and only then
apply the rulesets. Every later PR is opened by `humyna-bot`, which the owner can approve.

| | Factory profile | Product profile |
|---|---|---|
| Tonight | Merge both factory PRs and the workflow PR before `setup-repo.sh` | Install workflows and merge before `setup-repo.sh`; the first CI run happens without the ruleset |
| Later owner PR | Stuck. The owner turns the ruleset off, merges, and re-runs `setup-repo.sh`. Each time is logged in `docs/failures.md` | Same for any owner PR that touches a code-owner path: every new workflow install, every new product |
| Cost | No standing exception. But a manual off/on step that is easy to forget to turn back on (G-04). `main` is unprotected while it is off | Same, once per product and per workflow change |

### (b) One bypass actor: OrganizationAdmin, `bypass_mode: pull_request` (recommended)

`setup-repo.sh --owner-bypass` adds exactly one bypass actor, `{"actor_type":
"OrganizationAdmin", "actor_id": 1, "bypass_mode": "pull_request"}`. GitHub stores it with `actor_id` null
(Evidence); the read-back accepts null or 1 for this actor type and compares the mode. The mode is never `always`, and there is no bypass for
`humyna-bot`, any team, or any app. With this actor the owner can merge a PR on GitHub without an approval, but he still cannot push to
`main` directly, because the bypass applies only through a PR. The script refuses option (b) unless `humyna-bot`'s organization
role reads back as `member`, because an admin bot would be covered by the bypass too (guard G11; tested with the fake `gh`).

| | Factory profile | Product profile |
|---|---|---|
| Tonight | Rulesets can go on first. The owner merges his own PRs through the bypass | Same; the owner merges the workflow PR through the bypass |
| Later owner PR | Merge through the bypass after the checks are green (runbook) | Same |
| Bot PRs | Unchanged: they need the owner's approval (factory) or pass the code-owner rule (products) | Unchanged |
| Cost | The owner can also skip required checks when he merges. The runbook tells him to wait for green checks. If the bot's org role ever changes to admin, the bypass would cover it. The script checks this on every run, but it does not watch between runs | Same |

Why (b): in a one-person organization, approving your own PR adds no control. The control that
matters is that the bot cannot merge without the owner, and (b) keeps that. An admin can
edit or delete the ruleset anyway, so the bypass gives the owner no power he does not already have. It replaces
a manual off/on step, which is error-prone (G-04), with a permanent, narrow rule that is read back on every run.
`Deviation: none` from Section A. P-11 is kept, because the high-risk path still needs the owner, now as merger instead of
approver.

## Consequences

- `scripts/setup-repo.sh` gains `--owner-bypass`, `--require-checks`, per-profile merge settings,
  read-only workflow tokens, read-first ordering, a confirmation, and a full read-back.
- `docs/runbook.md` gives tonight's order for both options and the reviewed-clone commands.
- Verified on 2026-11-25 (Evidence): the bot's `gh pr merge` on a high-risk PR was refused, and the owner
  merged his own install PRs through the bypass.
- Still to verify (human): `git push origin main` from the owner's reviewed clone is refused (the bypass
  applies only through a pull request). Not reported tonight.

## Revisit

- When a GitHub App replaces the machine token.
- When a second human joins the organization: then option (b) must go, and approvals must be required.
- If GitHub starts to store or require an `actor_id` for OrganizationAdmin (the read-back would then name it).
