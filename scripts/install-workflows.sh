#!/usr/bin/env bash
# H-02: install reviewed workflow files from ci/workflows/ into .github/workflows/ (R-18).
# Run on the HOST as the human, from the reviewed clone (docs/runbook.md), after reviewing the files.
#   scripts/install-workflows.sh <owner/repo> [--dry-run] [--source <dir>]
# It clones the repo, refuses symlinks and unsafe workflow files, copies ci/workflows/*.yml|*.yaml
# to .github/workflows/, shows the full diff, asks you to type yes, then pushes a branch and opens
# a pull request for you to merge. Idempotent: does nothing if the files already match, and stops
# if an install pull request is already open.
# --dry-run changes nothing; with --source <local checkout> it also checks and previews the files.
set -eu
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "${here}/lib/common.sh"

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
    guard_workflow_permissions "${ct_root}/ci/workflows/${ct_name}" || die "refusing to install"
  done
  ok "checked: no symlinks, regular workflow files only, permissions blocks present, no write scopes"
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
  BRANCH="install-workflows-$(date -u +%Y%m%d-%H%M%S)"

  if [ "${DRY_RUN}" = 1 ]; then
    log "install-workflows (dry-run): ${R}"
    if [ -n "${SOURCE}" ]; then
      check_tree "${SOURCE}" source
      show_plan "${SOURCE}"
    else
      log "DRY  would clone ${R} and copy ci/workflows/*.yml (pass --source <dir> to check and preview files)"
    fi
    log "DRY  would show the full diff, ask you to type yes, push branch ${BRANCH} and open a pull request to main"
    log "dry-run complete: nothing was changed"
    return 0
  fi

  require_host
  require_cmd gh
  require_cmd git
  require_reviewed_checkout "${here}/.."
  trap 'on_exit_report; rm -rf "${work:-/nonexistent-install-workflows}"' EXIT
  gh30 auth status --hostname github.com >/dev/null 2>&1 || die "gh is not logged in. Run: gh auth login"
  # A5: converge instead of opening a second install pull request.
  open_pr=$(gh30 pr list -R "github.com/${R}" --state open --json headRefName,url --jq '.[] | select(.headRefName | startswith("install-workflows-")) | .url') || die "cannot list pull requests of ${R}"
  if [ -n "${open_pr}" ]; then
    ok "an install pull request is already open: $(safe "${open_pr}"). Merge or close it, then re-run."
    return 0
  fi
  work=$(mktemp -d)
  with_timeout 180 gh repo clone "${R}" "${work}/repo" -- --quiet || die "clone of ${R} failed"
  git -C "${work}/repo" remote set-url origin "https://github.com/${R}.git"
  guard_push_url "${work}/repo" "${REPO_NAME}" || die "refusing to continue: origin is redirected"
  check_tree "${work}/repo" full
  cd "${work}/repo"
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
  if git diff --cached --quiet; then
    ok "workflows already installed in ${R}; nothing to do"
    return 0
  fi
  log "Changes to install (review every line):"
  git --no-pager diff --cached --stat
  git --no-pager diff --cached
  log "Note: the repository's default workflow token must be read-only (scripts/setup-repo.sh sets it)."
  confirm_yes "Push branch ${BRANCH} to ${R} and open a pull request?" || die "not confirmed; nothing was pushed"
  git checkout -q -b "${BRANCH}"
  git commit -q -m "ci: install reviewed workflows from ci/workflows" -m "Installed by scripts/install-workflows.sh (H-02, R-18)."
  guard_push_url . "${REPO_NAME}" || die "refusing to push: origin is redirected"
  with_timeout 120 git push -q origin "${BRANCH}" || die "push failed (does your token have the workflow scope?)"
  done_step "pushed branch ${BRANCH} to ${R}"
  if ! gh30 pr create -R "github.com/${R}" --base main --head "${BRANCH}" \
    --title "ci: install reviewed workflows" \
    --body "Copies ci/workflows/*.yml to .github/workflows/ (H-02, R-18). Review the diff, then merge." >/dev/null; then
    die "pull request creation failed. Branch ${BRANCH} is pushed. Finish with: gh pr create -R ${R} --base main --head ${BRANCH}"
  fi
  done_step "opened a pull request from ${BRANCH}"
  url=$(gh30 pr view "${BRANCH}" -R "github.com/${R}" --json url --jq .url) || die "pull request not found after creation (branch ${BRANCH})"
  ok "pull request opened: ${url}"
  if [ "${REPO_NAME}" = "factory" ]; then
    log "After merging: tag the merge commit as v1 so products can call gates.yml@v1 (docs/runbook.md)."
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
