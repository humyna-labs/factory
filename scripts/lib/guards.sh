# Guards for the human-run scripts (W2-02: review findings A1 to A5, E1, E2; D2-night N2).
# Every file an agent can write is untrusted input to these scripts, which run with the owner's
# credentials on the Mac (handoff D2-W2, F4). Each guard returns 1 and prints REFUSED on stderr;
# the caller decides to stop. Each check sits between "# GUARD <id> begin/end" so that
# scripts/test/guards-mutation.test.ts can disable it in a scratch copy (G-03).
# bash 3.2 compatible. LC_ALL=C (set in common.sh) makes the bracket ranges byte ranges.

# Owner of every repository these scripts touch, and the machine account (ADR 0002).
ALLOWED_OWNER="humyna-labs"
MACHINE_ACCOUNT="humyna-bot"
# Write scopes a workflow may request. Empty: gates.yml and the product ci.yml need only reads.
ALLOWED_WRITE_SCOPES=""
MAX_WORKFLOW_BYTES=65536
MAX_LABELS_BYTES=16384
MAX_LABELS=100
# GitHub's limit for a label name is 50 characters.
MAX_LABEL_NAME=50
# The owner's working copy that is bind-mounted into the factory container (F4). Scripts must
# never run from there: the container can change any file in it (E2).
BIND_MOUNT_DIR="${HOME:-/nonexistent}/ai-projects/agent-factory"

refuse() { printf 'REFUSED %s\n' "$*" >&2; return 1; }

# Printable form of an untrusted name (no control characters reach the terminal).
safe() { printf '%s' "$1" | tr -c ' -~' '?'; }

# Lower-case form for path comparisons: macOS APFS is usually case-insensitive.
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

guard_repo_name() { # <name>  (A4)
  # GUARD G1 begin
  case "$1" in
    "" | . | ..) refuse "repository name '$(safe "$1")' is not allowed"; return 1 ;;
    *[!A-Za-z0-9._-]*) refuse "repository name '$(safe "$1")' must match ^[A-Za-z0-9._-]+\$"; return 1 ;;
  esac
  # GUARD G1 end
  return 0
}

guard_owner() { # <owner>  (A4)
  # GUARD G2 begin
  [ "$1" = "${ALLOWED_OWNER}" ] || { refuse "owner must be ${ALLOWED_OWNER}, got '$(safe "$1")'"; return 1; }
  # GUARD G2 end
  return 0
}

guard_slug() { # <team slug>  (A4)
  # GUARD G3 begin
  case "$1" in
    "" | -* | *[!A-Za-z0-9_-]*) refuse "team slug '$(safe "$1")' must match ^[A-Za-z0-9_-]+\$"; return 1 ;;
  esac
  # GUARD G3 end
  return 0
}

guard_no_symlinks() { # <dir>  (A1, W2-03): no symlink anywhere below <dir>, .git excluded
  [ -d "$1" ] || { refuse "not a directory: $(safe "$1")"; return 1; }
  # GUARD G4 begin
  if [ -L "$1" ]; then refuse "$(safe "$1") is a symlink"; return 1; fi
  # Codex 9: a scan that could not read everything is a failure, not a pass.
  gs_out=$(find "$1" -path "$1/.git" -prune -o -type l -print 2>/dev/null) || { refuse "could not scan all of $(safe "$1") for symlinks (find failed, for example an unreadable directory)"; return 1; }
  gs_hit=$(printf '%s\n' "${gs_out}" | sed -n 1p)
  if [ -n "${gs_hit}" ]; then refuse "symlink found: $(safe "${gs_hit}"). Symlinks are not allowed in factory or product repos (W2-03)"; return 1; fi
  # GUARD G4 end
  return 0
}

guard_inside() { # <root> <dir>  (A1): <dir> must resolve inside <root>
  gi_root=$(cd "$1" 2>/dev/null && pwd -P) || { refuse "cannot resolve $(safe "$1")"; return 1; }
  gi_dir=$(cd "$2" 2>/dev/null && pwd -P) || { refuse "cannot resolve $(safe "$2")"; return 1; }
  # GUARD G5 begin
  case "${gi_dir}" in
    "${gi_root}" | "${gi_root}"/*) ;;
    *) refuse "$(safe "$2") resolves to $(safe "${gi_dir}"), outside $(safe "${gi_root}")"; return 1 ;;
  esac
  # GUARD G5 end
  return 0
}

guard_ascii_text() { # <file> <display name>  (verifier P2, Codex 3): printable ASCII, tab, newline only
  [ -f "$1" ] && [ -r "$1" ] || { refuse "$2 is not a readable regular file"; return 1; }
  # GUARD G16 begin
  # Count the bytes left after deleting tab, newline and space..tilde. pipefail makes a read error
  # fail the count; command substitution would drop NUL bytes, so the bytes are never captured.
  ga_bad=$(set -o pipefail; tr -d '\011\012\040-\176' <"$1" | wc -c) || { refuse "$2 could not be read"; return 1; }
  ga_bad=$(printf '%s' "${ga_bad}" | tr -d ' ')
  [ "${ga_bad}" = 0 ] || { refuse "$2 contains ${ga_bad} byte(s) outside printable ASCII, tab and newline. Control bytes can hide text in your terminal; remove them"; return 1; }
  # GUARD G16 end
  return 0
}

guard_workflow_entries() { # <ci/workflows dir>  (A1): only regular *.yml/*.yaml files, size-limited
  ge_count=0
  for ge in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "${ge}" ] || [ -L "${ge}" ] || continue
    ge_name=${ge##*/}
    # GUARD G6 begin
    if [ -L "${ge}" ] || [ ! -f "${ge}" ]; then refuse "ci/workflows/$(safe "${ge_name}") is not a regular file"; return 1; fi
    case "${ge_name}" in
      .*) refuse "ci/workflows/$(safe "${ge_name}") is a hidden file; only visible *.yml and *.yaml files are installed"; return 1 ;;
      *[!A-Za-z0-9._-]*) refuse "ci/workflows/$(safe "${ge_name}"): file name must match ^[A-Za-z0-9._-]+\$"; return 1 ;;
      *.yml | *.yaml) ;;
      *) refuse "ci/workflows/$(safe "${ge_name}") is not a .yml or .yaml file"; return 1 ;;
    esac
    ge_size=$(wc -c <"${ge}" | tr -d ' ') || { refuse "cannot read ci/workflows/${ge_name}"; return 1; }
    case "${ge_size}" in "" | *[!0-9]*) refuse "cannot read the size of ci/workflows/${ge_name}"; return 1 ;; esac
    if [ "${ge_size}" -gt "${MAX_WORKFLOW_BYTES}" ]; then refuse "ci/workflows/${ge_name} is ${ge_size} bytes (max ${MAX_WORKFLOW_BYTES})"; return 1; fi
    # GUARD G6 end
    guard_ascii_text "${ge}" "ci/workflows/${ge_name}" || return 1
    ge_count=$((ge_count + 1))
  done
  [ "${ge_count}" -gt 0 ] || { refuse "no workflow files in ci/workflows"; return 1; }
  return 0
}

# The workflow checks below are line-based, not a YAML parser. They refuse instead of parsing:
# a token that matters (write, inherit, pull_request_target, workflow_run) is refused wherever it
# appears, including block scalars and comments, and G17 refuses the YAML constructs that could
# build such a token without spelling it (escapes, joined lines, explicit keys).
# Run guard_ascii_text (G16) first; these guards assume printable ASCII.

guard_workflow_permissions() { # <file>  (A2, verifier P3, Codex 2)
  gp_name=${1##*/}
  # GUARD G7 begin
  grep -Eq '^permissions:' "$1" || { refuse "${gp_name} has no top-level permissions: block"; return 1; }
  # N3 review: "permissions:" with no value is null, which means the default token permissions.
  if grep -Eq '^permissions:[[:space:]]*(~|null|Null|NULL)?[[:space:]]*(#.*)?$' "$1"; then
    gp_null=$(awk 'p == 1 && /^[[:space:]]*(#.*)?$/ { next } p == 1 { r = ($0 ~ /^[[:space:]]/) ? "ok" : "null"; p = 2; exit } /^permissions:[[:space:]]*(#.*)?$/ { p = 1 } /^permissions:[[:space:]]*(~|null|Null|NULL)[[:space:]]*(#.*)?$/ { r = "null"; exit } END { if (p == 1) r = "null"; print r }' "$1")
    [ "${gp_null}" != null ] || { refuse "${gp_name}: the top-level permissions: has no value (null means the default token); list the scopes, for example contents: read"; return 1; }
  fi
  # Lines that are exactly "<allowlisted scope>: write" are the only place a write token may appear.
  gp_allowed='^$'
  for gp_scope in ${ALLOWED_WRITE_SCOPES}; do gp_allowed="${gp_allowed}|^[[:space:]]*${gp_scope}:[[:space:]]*write[[:space:]]*\$"; done
  gp_hit=$(grep -Ev "${gp_allowed}" "$1" | grep -Ein '(^|[^A-Za-z0-9_])write(-all)?([^A-Za-z0-9_-]|$)' | sed -n 1p | cut -c1-80)
  if [ -n "${gp_hit}" ]; then refuse "${gp_name} contains a write token that is not an allowlisted '<scope>: write' line (ALLOWED_WRITE_SCOPES='${ALLOWED_WRITE_SCOPES}'): line $(safe "${gp_hit}"). Workflows get read-only tokens (A2)"; return 1; fi
  # GUARD G7 end
  return 0
}

guard_workflow_constructs() { # <file>  (N2d): YAML that a line-based check cannot see through
  gc_name=${1##*/}
  # GUARD G17 begin
  if grep -Eq '\\[xuU]' "$1"; then refuse "${gc_name} uses a \\x, \\u or \\U escape, which can spell a hidden word. Write the text plainly"; return 1; fi
  if grep -Eq '\\$' "$1"; then refuse "${gc_name} has a line that ends in a backslash; inside double quotes that joins lines into one word. Put the command on one line"; return 1; fi
  if grep -Eq '^[[:space:]]*(-[[:space:]]+)?\?([[:space:]]|$)' "$1"; then refuse "${gc_name} uses an explicit '? key' entry; write keys plainly"; return 1; fi
  # GUARD G17 end
  return 0
}

guard_workflow_triggers() { # <file>  (verifier P3, Codex 2): privileged triggers and secret hand-offs
  gt_name=${1##*/}
  # GUARD G18 begin
  gt_hit=$(grep -Eion '(^|[^A-Za-z0-9_])(pull_request_target|workflow_run|inherit|issue_comment|pull_request_review|pull_request_review_comment|discussion|discussion_comment)([^A-Za-z0-9_]|$)' "$1" | sed -n 1p)
  if [ -n "${gt_hit}" ]; then refuse "${gt_name} uses '$(safe "${gt_hit}")'. pull_request_target and workflow_run run with secrets on untrusted code, comment and review triggers run with secrets on text anyone can write, and secrets: inherit hands every secret to another workflow; none of them is allowed (the word itself is refused anywhere)"; return 1; fi
  # N3 review: toJSON(secrets) hands every secret over, like inherit.
  if grep -Eiq 'tojson[[:space:]]*\([[:space:]]*secrets' "$1"; then refuse "${gt_name} passes toJSON(secrets), which hands every secret to a step; pass only the named secret a step needs"; return 1; fi
  # GUARD G18 end
  return 0
}

guard_workflow_uses() { # <file>  (verifier P3, Codex 2): what a workflow may run
  gw_name=${1##*/}
  gw_n=0
  # GUARD G19 begin
  while IFS= read -r gw_line || [ -n "${gw_line}" ]; do
    gw_n=$((gw_n + 1))
    case "${gw_line}" in *[Uu][Ss][Ee][Ss]*) ;; *) continue ;; esac
    printf '%s\n' "${gw_line}" | grep -Eiq '(^|[^A-Za-z0-9_-])uses([^A-Za-z0-9_-]|$)' || continue
    # Comment lines cannot run anything.
    if printf '%s\n' "${gw_line}" | grep -Eq '^[[:space:]]*#'; then continue; fi
    gw_ref=$(printf '%s\n' "${gw_line}" | sed -nE "s/^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+[\"']?([^\"'[:space:]#]+)[\"']?[[:space:]]*(#.*)?\$/\\2/p")
    if [ -z "${gw_ref}" ]; then refuse "${gw_name} line ${gw_n}: write 'uses: <owner>/<repo>@<ref>' on one line, nothing else"; return 1; fi
    case "${gw_ref}" in
      *..*) refuse "${gw_name} line ${gw_n}: '$(safe "${gw_ref}")' contains '..'"; return 1 ;;
      "${ALLOWED_OWNER}"/*) ;;
      *)
        printf '%s\n' "${gw_ref}" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$' ||
          { refuse "${gw_name} line ${gw_n}: '$(safe "${gw_ref}")' is outside ${ALLOWED_OWNER}/ and not pinned to a full 40-hex commit SHA"; return 1; }
        ;;
    esac
  done <"$1"
  # N3 review: a job container or service image is external code too; it must be pinned by digest.
  gw_img=$(grep -En '^[[:space:]]*(-[[:space:]]+)?(image|container):[[:space:]]*[^[:space:]#]' "$1" | grep -Ev '@sha256:[0-9a-f]{64}["'"'"']?[[:space:]]*(#.*)?$' | sed -n 1p | cut -c1-80)
  if [ -n "${gw_img}" ]; then refuse "${gw_name} line $(safe "${gw_img}"): a container or service image must be pinned to @sha256:<64 hex>"; return 1; fi
  # GUARD G19 end
  return 0
}

guard_workflow_file() { # <file>: every content check for one workflow file, in order
  guard_ascii_text "$1" "${1##*/}" || return 1
  guard_workflow_constructs "$1" || return 1
  guard_workflow_permissions "$1" || return 1
  guard_workflow_triggers "$1" || return 1
  guard_workflow_uses "$1" || return 1
  return 0
}

guard_push_url() { # <git dir> <repo name>  (A4, Codex 4): exactly one URL each way, after rewriting
  gu_want="https://github.com/${ALLOWED_OWNER}/$2.git"
  gu_fetch=$(git -C "$1" remote get-url --all origin 2>/dev/null) || { refuse "cannot read the fetch URL of origin"; return 1; }
  gu_push=$(git -C "$1" remote get-url --push --all origin 2>/dev/null) || { refuse "cannot read the push URL of origin"; return 1; }
  # GUARD G8 begin
  [ "$(printf '%s\n' "${gu_fetch}" | wc -l | tr -d ' ')" = 1 ] || { refuse "origin has more than one fetch URL; expected only ${gu_want}"; return 1; }
  [ "$(printf '%s\n' "${gu_push}" | wc -l | tr -d ' ')" = 1 ] || { refuse "origin has more than one push URL (a push would go to all of them); expected only ${gu_want}"; return 1; }
  [ "${gu_fetch}" = "${gu_want}" ] || { refuse "origin fetch URL resolves to '$(safe "${gu_fetch}")', expected ${gu_want} (check url.*.insteadOf in your git config)"; return 1; }
  [ "${gu_push}" = "${gu_want}" ] || { refuse "origin push URL resolves to '$(safe "${gu_push}")', expected ${gu_want} (check url.*.pushInsteadOf and remote.origin.pushurl in your git config)"; return 1; }
  # GUARD G8 end
  return 0
}

guard_labels_file() { # <file>  (E1, Codex 10): agent-written; its fields become gh arguments
  if [ -L "$1" ] || [ ! -f "$1" ]; then refuse "$(safe "$1") must be a regular file, not a symlink"; return 1; fi
  guard_ascii_text "$1" "scripts/labels.txt" || return 1
  # GUARD G9 begin
  gl_size=$(wc -c <"$1" | tr -d ' ')
  [ "${gl_size}" -le "${MAX_LABELS_BYTES}" ] || { refuse "labels file is ${gl_size} bytes (max ${MAX_LABELS_BYTES})"; return 1; }
  gl_n=0
  gl_count=0
  gl_names="
"
  while IFS= read -r gl_line || [ -n "${gl_line}" ]; do
    gl_n=$((gl_n + 1))
    case "${gl_line}" in "" | \#*) continue ;; esac
    case "${gl_line}" in *[!\ -~]*) refuse "labels line ${gl_n}: not printable ASCII"; return 1 ;; esac
    gl_name=${gl_line%%|*}
    gl_rest=${gl_line#*|}
    gl_color=${gl_rest%%|*}
    gl_desc=${gl_rest#*|}
    case "${gl_rest}" in *"|"*) ;; *) refuse "labels line ${gl_n}: expected name|color|description"; return 1 ;; esac
    case "${gl_desc}" in *"|"*) refuse "labels line ${gl_n}: too many fields"; return 1 ;; esac
    case "${gl_name}" in "" | -* | *[!a-z0-9:-]*) refuse "labels line ${gl_n}: bad name"; return 1 ;; esac
    [ "${#gl_name}" -le "${MAX_LABEL_NAME}" ] || { refuse "labels line ${gl_n}: name over ${MAX_LABEL_NAME} characters"; return 1; }
    case "${gl_names}" in *"
${gl_name}
"*) refuse "labels line ${gl_n}: duplicate name ${gl_name}"; return 1 ;; esac
    gl_names="${gl_names}${gl_name}
"
    case "${gl_color}" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) refuse "labels line ${gl_n}: bad color"; return 1 ;; esac
    case "${gl_desc}" in "" | -* | " "* | *" ") refuse "labels line ${gl_n}: bad description (empty, leading -, or leading or trailing space)"; return 1 ;; esac
    [ "${#gl_desc}" -le 100 ] || { refuse "labels line ${gl_n}: description over 100 characters"; return 1; }
    gl_count=$((gl_count + 1))
  done <"$1"
  [ "${gl_count}" -le "${MAX_LABELS}" ] || { refuse "labels file has ${gl_count} labels (max ${MAX_LABELS})"; return 1; }
  # GUARD G9 end
  return 0
}

guard_reviewed_checkout() { # <factory checkout root>  (E2, Codex 1 and 5). Catches accidents; the control is the runbook.
  gr_root=$(cd "$1" 2>/dev/null && pwd -P) || { refuse "cannot resolve $(safe "$1")"; return 1; }
  # GUARD G10 begin
  gr_mount=$(cd "${BIND_MOUNT_DIR}" 2>/dev/null && pwd -P || printf '%s' "${BIND_MOUNT_DIR}")
  for gr_m in "$(lower "${gr_mount}")" "$(lower "${BIND_MOUNT_DIR}")"; do
    case "$(lower "${gr_root}")/" in
      "${gr_m}"/*) refuse "this copy (${gr_root}) is inside the container's bind mount ${BIND_MOUNT_DIR}. Run the scripts from the separate reviewed clone (docs/runbook.md, Reviewed clone)"; return 1 ;;
    esac
  done
  guard_no_symlinks "${gr_root}/scripts" || return 1
  guard_no_symlinks "${gr_root}/ci" || return 1
  # GUARD G10 end
  # GUARD G13 begin
  gr_branch=$(git -C "${gr_root}" symbolic-ref -q HEAD 2>/dev/null) || { refuse "${gr_root} is not on a branch (detached HEAD?); check out main"; return 1; }
  [ "${gr_branch}" = "refs/heads/main" ] || { refuse "${gr_root} is on ${gr_branch}, not main. Run: git checkout main"; return 1; }
  gr_up=$(git -C "${gr_root}" rev-parse --symbolic-full-name 'main@{upstream}' 2>/dev/null) || { refuse "main has no upstream; run: git branch -u origin/main main"; return 1; }
  [ "${gr_up}" = "refs/remotes/origin/main" ] || { refuse "main tracks ${gr_up}, not origin/main. Run: git branch -u origin/main main"; return 1; }
  # GUARD G13 end
  # GUARD G14 begin
  gr_status=$(git -C "${gr_root}" status --porcelain --untracked-files=all 2>/dev/null) || { refuse "git status failed in ${gr_root}; a checkout git cannot read is not a reviewed clone"; return 1; }
  [ -z "${gr_status}" ] || { refuse "the factory checkout ${gr_root} has uncommitted or untracked changes"; return 1; }
  # Files flagged assume-unchanged (lower-case tag) or skip-worktree (S) hide local edits from git status.
  gr_flags=$(git -C "${gr_root}" ls-files -v 2>/dev/null) || { refuse "git ls-files failed in ${gr_root}"; return 1; }
  gr_hidden=$(printf '%s\n' "${gr_flags}" | grep -v '^H ' | grep -v '^$' | sed -n 1p)
  [ -z "${gr_hidden}" ] || { refuse "a tracked file is flagged assume-unchanged or skip-worktree ($(safe "${gr_hidden}")), so git status cannot see its changes. Make a fresh reviewed clone"; return 1; }
  # GUARD G14 end
  return 0
}

guard_at_upstream() { # <factory checkout root>  (E2): HEAD is the freshly fetched origin/main
  gh_head=$(git -C "$1" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) || { refuse "$(safe "$1") is not a git checkout"; return 1; }
  # GUARD G15 begin
  gh_up=$(git -C "$1" rev-parse -q --verify 'refs/remotes/origin/main^{commit}' 2>/dev/null) || { refuse "no fetched origin/main in $(safe "$1")"; return 1; }
  [ "${gh_head}" = "${gh_up}" ] || { refuse "HEAD ${gh_head} is not the fetched origin/main ${gh_up}; run git pull --ff-only in the reviewed clone"; return 1; }
  # GUARD G15 end
  log "Running scripts from commit ${gh_head}. Compare it with the merged pull request."
  return 0
}

guard_bot_not_admin() { # <organization role of the machine account>  (ADR 0002 option b)
  # GUARD G11 begin
  [ "$1" = "member" ] || { refuse "${MACHINE_ACCOUNT} has organization role '$(safe "$1")'; the OrganizationAdmin bypass would cover the bot too. Make it a member first, or use option (a)"; return 1; }
  # GUARD G11 end
  return 0
}

confirm_yes() { # <question>  (A2, A3, Codex 3): the owner must type exactly yes, at a terminal
  # GUARD G12 begin
  [ -t 0 ] || { refuse "the confirmation must come from your terminal; stdin is not a terminal (piping yes is not accepted)"; return 1; }
  # GUARD G12 end
  printf '%s Type yes to continue: ' "$1"
  cy_answer=""
  IFS= read -r cy_answer || cy_answer=""
  # GUARD G20 begin
  [ "${cy_answer}" = "yes" ] || { refuse "not confirmed (answer was not exactly yes)"; return 1; }
  # GUARD G20 end
  return 0
}
