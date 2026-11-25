#!/usr/bin/env bash
# H-02: install reviewed workflow files from ci/workflows/ into .github/workflows/ (R-18).
# Run on the HOST as the human, from the reviewed clone (docs/runbook.md), after reviewing the files.
#   scripts/install-workflows.sh <owner/repo> [--dry-run] [--source <dir>]
# It clones the repo, starts from its fetched main, refuses symlinks and unsafe workflow files,
# copies ci/workflows/*.yml|*.yaml to .github/workflows/, shows the change through an escaped view,
# asks you to type yes at the terminal, then pushes a branch and opens a pull request for you to
# merge. Idempotent: does nothing if the files already match, and stops if an install pull
# request or an install branch already exists.
# --dry-run changes nothing; with --source <local checkout> it also checks and previews the files.
set -eu
# CHECK E1 begin  (Codex 1, N2b): before any library is sourced or git runs, refuse to start
# from the container's bind mount. Accident guard only: the reviewed clone is the control.
case "${BASH_SOURCE[0]}" in */*) here=${BASH_SOURCE[0]%/*} ;; *) here=. ;; esac
if [ -L "${BASH_SOURCE[0]}" ]; then printf 'FAIL run the script itself, not a symlink to it\n' >&2; exit 1; fi
here=$(cd "${here}" && pwd -P) || { printf 'FAIL cannot resolve the script directory\n' >&2; exit 1; }
mount_dir="${HOME:-/nonexistent}/ai-projects/agent-factory"
mount_phys=$(cd "${mount_dir}" 2>/dev/null && pwd -P || printf '%s' "${mount_dir}")
for m in "${mount_dir}" "${mount_phys}"; do
  case "$(printf '%s/' "${here}" | tr 'A-Z' 'a-z')" in
    "$(printf '%s' "${m}" | tr 'A-Z' 'a-z')"/*) printf 'FAIL this script is inside the bind mount %s, which the factory container can change. Run it from ~/ai-projects/factory-reviewed (docs/runbook.md)\n' "${mount_dir}" >&2; exit 1 ;;
  esac
done
# CHECK E1 end
. "${here}/lib/common.sh"

BRANCH_PREFIX="install-workflows-"

usage() {
  log "usage: install-workflows.sh <owner/repo> [--dry-run] [--source <local checkout>]"
  exit 64
}

# Workflow file names under <root>/ci/workflows (names are validated by guard_workflow_entries).
workflow_files() {
  for wf in "$1"/ci/workflows/*.yml "$1"/ci/workflows/*.yaml; do
    [ -f "${wf}" ] && printf '%s\n' "${wf##*/}"
  done
  return 0
}

# check_tree <root> <full|source>: A1 and A2 checks. "full" (a fresh clone) refuses any symlink in
# the whole tree; "source" (a local checkout with node_modules) checks ci/ and .github/ only.
check_tree() {
  ct_root=$1
  if [ "$2" = full ]; then
    guard_no_symlinks "${ct_root}" || die "refusing to install from ${R}"
  else
    guard_no_symlinks "${ct_root}/ci" || die "refusing to install from $(safe "${ct_root}")"
    if [ -e "${ct_root}/.github" ] || [ -L "${ct_root}/.github" ]; then guard_no_symlinks "${ct_root}/.github" || die "refusing to install"; fi
  fi
  [ -d "${ct_root}/ci/workflows" ] || die "no ci/workflows directory in $(safe "${ct_root}")"
  guard_inside "${ct_root}" "${ct_root}/ci/workflows" || die "refusing to install"
  if [ -d "${ct_root}/.github" ]; then guard_inside "${ct_root}" "${ct_root}/.github" || die "refusing to install"; fi
  guard_workflow_entries "${ct_root}/ci/workflows" || die "refusing to install"
  for ct_name in $(workflow_files "${ct_root}"); do
    guard_workflow_file "${ct_root}/ci/workflows/${ct_name}" || die "refusing to install"
  done
  ok "checked: no symlinks, regular printable-ASCII workflow files, permissions blocks, no write tokens, no privileged triggers, pinned actions"
}

show_plan() { # <checkout dir>
  for sp_name in $(workflow_files "$1"); do
    sp_dest="$1/.github/workflows/${sp_name}"
    if [ -f "${sp_dest}" ] && cmp -s "$1/ci/workflows/${sp_name}" "${sp_dest}"; then
      log "SAME ${sp_name} is already installed"
    else
      log "COPY ci/workflows/${sp_name} -> .github/workflows/${sp_name}"
    fi
  done
}

main() {
  TARGET=""
  SOURCE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --source) [ $# -ge 2 ] || usage; SOURCE=$2; shift ;;
      -h | --help) usage ;;
      -*) die "unknown option $(safe "$1")" ;;
      *) [ -z "${TARGET}" ] || usage; TARGET=$1 ;;
    esac
    shift
  done
  [ -n "${TARGET}" ] || usage
  parse_repo "${TARGET}"
  R="${REPO_OWNER}/${REPO_NAME}"
  BRANCH="${BRANCH_PREFIX}$(date -u +%Y%m%d-%H%M%S)"

  # Where this runs (Codex 1, 5): the same checks for dry runs and real runs.
  preflight_location "${here}/.."

  if [ "${DRY_RUN}" = 1 ]; then
    log "install-workflows (dry-run): ${R}"
    if [ -n "${SOURCE}" ]; then
      check_tree "${SOURCE}" source
      show_plan "${SOURCE}"
    else
      log "DRY  would clone ${R} and copy ci/workflows/*.yml (pass --source <dir> to check and preview files)"
    fi
    log "DRY  would show the change against ${R} main, ask you to type yes, push branch ${BRANCH} and open a pull request to main"
    log "dry-run complete: nothing was changed"
    return 0
  fi

  require_cmd gh
  trap 'on_exit_report; rm -rf "${work:-/nonexistent-install-workflows}"' EXIT
  gh30 auth status --hostname github.com >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
  me=$(ghapi user --jq .login) || die "cannot read your GitHub login"
  case "${me}" in "" | *[!A-Za-z0-9-]*) die "unexpected GitHub login '$(safe "${me}")'" ;; esac
  # CHECK I1 begin  (Codex 2): installed workflows run with the default token, which must be read-only.
  token=$(ghapi "repos/${R}/actions/permissions/workflow" --jq .default_workflow_permissions) || die "cannot read the workflow token setting of ${R}"
  [ "${token}" = "read" ] || die "the default workflow token of ${R} is '$(safe "${token}")', not read. Run scripts/setup-repo.sh ${R} first"
  # CHECK I1 end
  # CHECK I2 begin  (A5, Codex 13): converge on an open install PR by you, from humyna-labs, to main.
  open_pr=$(gh30 pr list -R "github.com/${R}" --state open --base main --json headRefName,baseRefName,author,headRepositoryOwner,url \
    --jq ".[] | select((.headRefName | startswith(\"${BRANCH_PREFIX}\")) and .baseRefName == \"main\" and .author.login == \"${me}\" and .headRepositoryOwner.login == \"${ALLOWED_OWNER}\") | .url") || die "cannot list pull requests of ${R}"
  # CHECK I2 end
  if [ -n "${open_pr}" ]; then
    ok "an install pull request is already open: $(safe "${open_pr}"). Merge or close it, then re-run."
    return 0
  fi
  work=$(mktemp -d)
  with_timeout 180 gh repo clone "${R}" "${work}/repo" -- --quiet || die "clone of ${R} failed"
  git -C "${work}/repo" remote set-url origin "https://github.com/${R}.git"
  guard_push_url "${work}/repo" "${REPO_NAME}" || die "refusing to continue: origin is redirected"
  # CHECK I3 begin  (Codex 7, N2e): start from main as the clone fetched it, not the default branch.
  base=$(git -C "${work}/repo" rev-parse -q --verify "refs/remotes/origin/main^{commit}") || die "${R} has no main branch to install into"
  git -C "${work}/repo" checkout -q --detach "${base}" || die "cannot check out main of ${R}"
  # CHECK I3 end
  # CHECK I4 begin  (verifier P5): a pushed install branch without an open PR means an earlier run
  # stopped after its push; pushing another branch would leave two.
  # The clone fetched every branch of the remote into refs/remotes/origin/.
  stale=$(git -C "${work}/repo" for-each-ref --format='%(refname:lstrip=3)' "refs/remotes/origin/${BRANCH_PREFIX}*") || die "cannot list the branches of ${R}"
  if [ -n "${stale}" ]; then
    stale_name=$(printf '%s\n' "${stale}" | sed -n 1p)
    die "branch $(safe "${stale_name}") already exists on ${R} without an open install pull request by you. Open it with: gh pr create -R github.com/${R} --base main --head $(safe "${stale_name}"), or delete the branch, then re-run"
  fi
  # CHECK I4 end
  check_tree "${work}/repo" full
  cd "${work}/repo"
  log "Base: ${R} main at ${base}"
  show_plan .
  mkdir -p .github/workflows
  guard_inside . .github/workflows || die "refusing to install"
  for name in $(workflow_files .); do
    dest=".github/workflows/${name}"
    if [ -L "${dest}" ]; then die "${dest} is a symlink; refusing to write through it"; fi
    cat "ci/workflows/${name}" >"${dest}"
  done
  guard_no_symlinks . || die "symlink appeared during the copy; refusing to continue"
  git add .github/workflows
  if git diff --cached --quiet "${base}"; then
    ok "workflows already installed in ${R}; nothing to do"
    return 0
  fi
  # CHECK I5 begin  (Codex 3, 9): the staged blobs are exactly the checked source files.
  for name in $(workflow_files .); do
    git cat-file blob ":.github/workflows/${name}" | cmp -s - "ci/workflows/${name}" || die "staged .github/workflows/${name} differs from the checked source; refusing"
    guard_workflow_file ".github/workflows/${name}" || die "refusing to install"
  done
  # CHECK I5 end
  tree=$(git write-tree)
  # CHECK I6 begin  (verifier P2, Codex 3): an escaped view that ignores diff attributes and drivers.
  log "Changes to install against main ${base} (escaped view: a control byte would show as ^X or M-x; review every line):"
  (set -o pipefail; git --no-pager -c core.quotePath=true diff --cached --stat --text --no-ext-diff --no-textconv --no-color "${base}" | cat -v) || die "cannot show the change; refusing"
  (set -o pipefail; git --no-pager -c core.quotePath=true diff --cached --text --no-ext-diff --no-textconv --no-color "${base}" | cat -v) || die "cannot show the change; refusing"
  # CHECK I6 end
  log "Staged tree ${tree}. The default workflow token of ${R} is read-only (checked)."
  confirm_yes "Push branch ${BRANCH} to ${R} and open a pull request?" || die "not confirmed; nothing was pushed"
  git checkout -q -b "${BRANCH}"
  git commit -q -m "ci: install reviewed workflows from ci/workflows" -m "Installed by scripts/install-workflows.sh (H-02, R-18)."
  # CHECK I7 begin  (Codex 3): push exactly what was shown, on top of main.
  [ "$(git rev-parse 'HEAD^{tree}')" = "${tree}" ] || die "the commit's tree differs from the tree you reviewed; refusing to push"
  [ "$(git rev-parse 'HEAD^')" = "${base}" ] || die "the commit's parent is not main ${base}; refusing to push"
  # CHECK I7 end
  guard_push_url . "${REPO_NAME}" || die "refusing to push: origin is redirected"
  mutate "pushed branch ${BRANCH} to ${R}" 120 git push -q origin "refs/heads/${BRANCH}:refs/heads/${BRANCH}" || die "push failed (does your token have the workflow scope?)"
  mutate "opened a pull request from ${BRANCH}" 30 gh pr create -R "github.com/${R}" --base main --head "${BRANCH}" \
    --title "ci: install reviewed workflows" \
    --body "Copies ci/workflows/*.yml to .github/workflows/ (H-02, R-18). Review the diff, then merge." </dev/null >/dev/null ||
    die "pull request creation failed or its outcome is unknown. Branch ${BRANCH} is pushed. Check the pull requests of ${R}; if none is open, run: gh pr create -R github.com/${R} --base main --head ${BRANCH}"
  url=$(gh30 pr view "${BRANCH}" -R "github.com/${R}" --json url --jq .url) || die "pull request not found after creation (branch ${BRANCH})"
  ok "pull request opened: $(safe "${url}")"
  if [ "${REPO_NAME}" = "factory" ]; then
    log "After merging: tag the merge commit so products can call gates.yml (docs/runbook.md)."
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
