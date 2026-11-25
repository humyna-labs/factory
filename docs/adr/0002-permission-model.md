# ADR 0002: Permission model for the machine account, rulesets and merges

- Status: proposed (handoff D2-W2; the owner decides option a or b tonight)
- Date: 2026-11-25
- Principles: P-02, P-08, P-11, G-02, G-04, G-07, R-02, R-07, R-18, R-19
- API fields: every GitHub API field named here (ruleset `bypass_actors`, `OrganizationAdmin`
  actor id 1, `bypass_mode`, `strict_required_status_checks_policy`,
  `actions/permissions/workflow`, `orgs/<org>/memberships/<user>`) is written from memory and
  not run. No live GitHub call was allowed in this window. `scripts/setup-repo.sh` reads every
  field back after writing it, so the first real run will show any wrong field by name.

## Context

- F1: pushing `factory/v1` as `humyna-bot` failed with 403, so the machine token has no write access on
  `humyna-labs/factory`. Spec 3.6 says "the factory repo is read-only to agents". Brief D2 says the token can write
  contents, PRs and issues. The coach wrote both, so the two conflict.
- Review findings A3 and A5: `setup-repo.sh` replaced the ruleset blindly, the factory profile had no
  approval rule, the product profile let a branch that is behind its base pass, and the read-back checked almost nothing.
- Deadlock: once an approval rule is on, every PR that the owner opens is stuck, because an author cannot
  approve his own PR. `install-workflows.sh` opens its PR with the owner's credentials. On products that PR
  touches `.github/workflows/`, a code-owner path whose only code owner is the owner. It is not limited
  to `factory/v1`.

## Decision

1. **Machine account.** `humyna-bot` gets Write on the factory repository and on every product
   repository. It needs that to push feature branches and open PRs. It never merges on the factory, and it
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
7. **The deadlock:** two options follow. The owner chooses one tonight. The recommendation is (b).

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
"OrganizationAdmin", "actor_id": 1, "bypass_mode": "pull_request"}`. The mode is never `always`, and there is no bypass for
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
- To verify (human, tonight):
  - The H-01 verification PR. The bot's `gh pr merge` on a high-risk PR must be refused.
  - With (b): the owner can merge his own PR without an approval, and `git push origin main` from the owner's
    clone is still refused.

## Revisit

- When a GitHub App replaces the machine token.
- When a second human joins the organization: then option (b) must go, and approvals must be required.
- After the first real ruleset read-back, if any field name above turns out to be wrong.
