# Guards for the human-run scripts (W2-02: review findings A1 to A5, E1, E2).
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
# The owner's working copy that is bind-mounted into the factory container (F4). Scripts must
# never run from there: the container can change any file in it (E2).
BIND_MOUNT_DIR="${HOME:-/nonexistent}/ai-projects/agent-factory"

refuse() { printf 'REFUSED %s\n' "$*" >&2; return 1; }

# Printable form of an untrusted name (no control characters reach the terminal).
safe() { printf '%s' "$1" | tr -c ' -~' '?'; }

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
  gs_hit=$(find "$1" -path "$1/.git" -prune -o -type l -print 2>/dev/null | head -n 1)
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

guard_workflow_entries() { # <ci/workflows dir>  (A1): only regular *.yml/*.yaml files, size-limited
  ge_count=0
  for ge in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "${ge}" ] || [ -L "${ge}" ] || continue
    ge_name=${ge##*/}
    # GUARD G6 begin
    if [ -L "${ge}" ] || [ ! -f "${ge}" ]; then refuse "ci/workflows/$(safe "${ge_name}") is not a regular file"; return 1; fi
    case "${ge_name}" in
      *[!A-Za-z0-9._-]*) refuse "ci/workflows/$(safe "${ge_name}"): file name must match ^[A-Za-z0-9._-]+\$"; return 1 ;;
      *.yml | *.yaml) ;;
      *) refuse "ci/workflows/$(safe "${ge_name}") is not a .yml or .yaml file"; return 1 ;;
    esac
    ge_size=$(wc -c <"${ge}" | tr -d ' ')
    if [ "${ge_size}" -gt "${MAX_WORKFLOW_BYTES}" ]; then refuse "ci/workflows/${ge_name} is ${ge_size} bytes (max ${MAX_WORKFLOW_BYTES})"; return 1; fi
    # GUARD G6 end
    ge_count=$((ge_count + 1))
  done
  [ "${ge_count}" -gt 0 ] || { refuse "no workflow files in ci/workflows"; return 1; }
  return 0
}

guard_workflow_permissions() { # <file>  (A2). Line-based, errs on the side of refusing.
  # Limits: not a YAML parser. Anchors, aliases or multi-line flow maps that hide a write scope
  # are not understood; such files are refused only if a "<scope>: write" pair is visible.
  # GUARD G7 begin
  grep -Eq '^permissions:' "$1" || { refuse "${1##*/} has no top-level permissions: block"; return 1; }
  if grep -Eq 'write-all' "$1"; then refuse "${1##*/} grants write-all"; return 1; fi
  for gp_scope in $(grep -Eo '[A-Za-z_-]+["'"'"']?[[:space:]]*:[[:space:]]*["'"'"']?write([^A-Za-z_-]|$)' "$1" | sed -E 's/^([A-Za-z_-]+).*/\1/'); do
    case " ${ALLOWED_WRITE_SCOPES} " in
      *" ${gp_scope} "*) ;;
      *) refuse "${1##*/} grants ${gp_scope}: write, which is not on the allowlist (ALLOWED_WRITE_SCOPES='${ALLOWED_WRITE_SCOPES}')"; return 1 ;;
    esac
  done
  # GUARD G7 end
  return 0
}

guard_push_url() { # <git dir> <repo name>  (A4): fetch and push URL after insteadOf rewriting
  gu_want="https://github.com/${ALLOWED_OWNER}/$2.git"
  gu_fetch=$(git -C "$1" remote get-url origin 2>/dev/null || true)
  gu_push=$(git -C "$1" remote get-url --push origin 2>/dev/null || true)
  # GUARD G8 begin
  [ "${gu_fetch}" = "${gu_want}" ] || { refuse "origin fetch URL resolves to '$(safe "${gu_fetch}")', expected ${gu_want} (check url.*.insteadOf in your git config)"; return 1; }
  [ "${gu_push}" = "${gu_want}" ] || { refuse "origin push URL resolves to '$(safe "${gu_push}")', expected ${gu_want} (check url.*.pushInsteadOf in your git config)"; return 1; }
  # GUARD G8 end
  return 0
}

guard_labels_file() { # <file>  (E1): agent-written; its fields become gh arguments
  # GUARD G9 begin
  if [ -L "$1" ] || [ ! -f "$1" ]; then refuse "$(safe "$1") must be a regular file, not a symlink"; return 1; fi
  gl_n=0
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
    case "${gl_color}" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) refuse "labels line ${gl_n}: bad color"; return 1 ;; esac
    case "${gl_desc}" in "" | -*) refuse "labels line ${gl_n}: bad description"; return 1 ;; esac
    [ "${#gl_desc}" -le 100 ] || { refuse "labels line ${gl_n}: description over 100 characters"; return 1; }
  done <"$1"
  # GUARD G9 end
  return 0
}

guard_reviewed_checkout() { # <factory checkout root>  (E2). Catches accidents; the control is the runbook.
  gr_root=$(cd "$1" 2>/dev/null && pwd -P) || { refuse "cannot resolve $(safe "$1")"; return 1; }
  # GUARD G10 begin
  gr_mount=$(cd "${BIND_MOUNT_DIR}" 2>/dev/null && pwd -P || printf '%s' "${BIND_MOUNT_DIR}")
  case "${gr_root}" in
    "${gr_mount}" | "${gr_mount}"/*) refuse "this copy (${gr_root}) is inside the container's bind mount ${gr_mount}. Run the scripts from the separate reviewed clone (docs/runbook.md, Reviewed clone)"; return 1 ;;
  esac
  guard_no_symlinks "${gr_root}/scripts" || return 1
  guard_no_symlinks "${gr_root}/ci" || return 1
  [ -z "$(git -C "${gr_root}" status --porcelain --untracked-files=all 2>/dev/null)" ] || { refuse "the factory checkout ${gr_root} has uncommitted or untracked changes"; return 1; }
  gr_head=$(git -C "${gr_root}" rev-parse HEAD 2>/dev/null) || { refuse "${gr_root} is not a git checkout"; return 1; }
  gr_up=$(git -C "${gr_root}" rev-parse '@{upstream}' 2>/dev/null) || { refuse "the checked-out branch has no upstream; check out the merged main of the reviewed clone"; return 1; }
  [ "${gr_head}" = "${gr_up}" ] || { refuse "HEAD ${gr_head} is not the fetched upstream ${gr_up}; run git pull --ff-only in the reviewed clone"; return 1; }
  # GUARD G10 end
  log "Running scripts from commit ${gr_head}. Compare it with the merged pull request."
  return 0
}

guard_bot_not_admin() { # <organization role of the machine account>  (ADR 0002 option b)
  # GUARD G11 begin
  [ "$1" = "member" ] || { refuse "${MACHINE_ACCOUNT} has organization role '$(safe "$1")'; the OrganizationAdmin bypass would cover the bot too. Make it a member first, or use option (a)"; return 1; }
  # GUARD G11 end
  return 0
}

confirm_yes() { # <question>  (A2, A3): the owner must type exactly yes
  printf '%s Type yes to continue: ' "$1"
  cy_answer=""
  read -r cy_answer || cy_answer=""
  # GUARD G12 begin
  [ "${cy_answer}" = "yes" ] || { refuse "not confirmed (answer was not exactly yes)"; return 1; }
  # GUARD G12 end
  return 0
}
