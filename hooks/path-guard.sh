#!/usr/bin/env bash
# path-guard: per-role write policy for factory role sessions (R-03, P-08, P-11).
#
# Hook mode (Claude Code PreToolUse, matcher Edit|Write|MultiEdit|NotebookEdit|Bash):
#   path-guard.sh <role>                      reads the hook JSON on stdin
# Check mode (the coordinator, after each session, for every changed path):
#   path-guard.sh <role> --check <worktree> <path>
# Exit 0 allows. Exit 2 blocks; the message on stderr tells the agent what to do instead.
#
# Every rule sits between "# RULE <id> begin" and "# RULE <id> end" so that
# hooks/test/mutation.test.ts can disable each rule in a scratch copy (R-16, G-03).
# Runs inside the container only (GNU realpath, jq).
set -u

role=${1:-}
REPORTS_DIR=${FACTORY_REPORTS_DIR:-/workspace/runs/reports}
GUARD_LOG=${FACTORY_GUARD_LOG:-/workspace/runs/guard.log}
mode=hook
tool=check

log_block() {
  [ "$mode" = hook ] || return 0
  mkdir -p "$(dirname "$GUARD_LOG")" 2>/dev/null || return 0
  printf '%s role=%s tool=%s rule=%s target=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$role" "$tool" "$1" "$2" >>"$GUARD_LOG" 2>/dev/null || true
}

deny() { # <rule> <target> <remediation>
  log_block "$1" "$2"
  printf 'path-guard: BLOCKED rule=%s role=%s target=%s\n%s\n' "$1" "$role" "$2" "$3" >&2
  exit 2
}

allow() { # <rule>
  printf 'path-guard: allowed rule=%s\n' "$1" >&2
  exit 0
}

# ---------------------------------------------------------------- paths
check_path() { # <root> <path>
  root=$(realpath -m -- "$1")
  case "$2" in
    /*) target=$(realpath -m -- "$2") ;;
    *) target=$(realpath -m -- "$root/$2") ;;
  esac
  reports=$(realpath -m -- "$REPORTS_DIR")

  # RULE R1 begin  (the session report is the one write allowed outside the worktree, R-20)
  case "$target" in
    "$reports"/*)
      inner=${target#"$reports"/}
      case "$inner" in
        */*/*) ;;
        */*.md) allow R1 ;;
      esac
      deny R1 "$target" "Reports go to ${REPORTS_DIR}/<task>/<name>.md exactly; nothing else under the reports directory."
      ;;
  esac
  # RULE R1 end

  # RULE R2 begin  (stay inside the task worktree)
  case "$target" in
    "$root"/*) ;;
    *) deny R2 "$target" "Write only inside your task worktree ${root}. Put anything else in your report." ;;
  esac
  # RULE R2 end
  rel=${target#"$root"/}

  # RULE R3 begin  (harness files are never written by roles)
  case "$rel" in
    .git | .git/* | */.git/* | .github/* | */.github/* | .githooks/* | .factory/* | .claude/* | */.claude/* | CODEOWNERS | */CODEOWNERS)
      deny R3 "$rel" "Harness, CI and repo-config files are high risk (R-18). Propose the change in report section 8; a human applies it."
      ;;
  esac
  # RULE R3 end

  # RULE R4 begin  (only the verify stage marks features as passing, P-06)
  case "$rel" in
    feature_list.json | */feature_list.json)
      deny R4 "$rel" "feature_list.json is updated only by the coordinator's verify stage (P-06). Do not edit it."
      ;;
  esac
  # RULE R4 end

  case "$role" in
    qa)
      # RULE R5 begin  (QA writes tests and evals only)
      case "$rel" in
        tests/* | evals/*) allow R5 ;;
      esac
      # RULE R5 end
      deny R5 "$rel" "QA writes only tests/ and evals/. If src/ needs a change, describe it in your report."
      ;;
    builder)
      # RULE R6 begin  (contracts, templates and security code are not the builder's)
      case "$rel" in
        src/contracts/* | src/templates/* | src/security/*)
          deny R6 "$rel" "src/contracts, src/templates and src/security belong to other roles or need a human. Propose the change in your report."
          ;;
      esac
      # RULE R6 end
      # RULE R7 begin  (the builder writes src/ only)
      case "$rel" in
        src/*) allow R7 ;;
      esac
      # RULE R7 end
      deny R7 "$rel" "The builder writes only src/. Never edit tests: if a test looks wrong, say so in your report and FAIL."
      ;;
    reviewer | compliance)
      # RULE R8 begin  (read-only roles)
      deny R8 "$rel" "The ${role} role is read-only. Write findings in your report only."
      # RULE R8 end
      ;;
  esac
  # RULE R9 begin  (unknown role or no matching rule: deny by default)
  deny R9 "$rel" "No rule allows this write for role '${role}'. Unknown roles may not write."
  # RULE R9 end
}

# ---------------------------------------------------------------- bash commands
check_bash() { # <command>
  cmd=$1
  # Neutralise harmless redirections before looking for writes.
  scrubbed=$(printf '%s' "$cmd" | sed -E 's#[0-9]*>&[0-9]+##g; s#[0-9]*>[[:space:]]*/dev/null##g')

  # RULE B1 begin  (no role pushes, commits, merges or changes labels: the coordinator does, R-02)
  if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_./-])(gh[[:space:]]|git[[:space:]]+(push|commit|merge|rebase|tag)([[:space:]]|$))'; then
    deny B1 "$cmd" "Only the coordinator commits, pushes, merges and labels (R-02). Finish your work and end the session."
  fi
  if printf '%s' "$cmd" | grep -Eq 'dangerously[-]skip|permission-mode[[:space:]=]+bypass'; then
    deny B1 "$cmd" "Permission bypass is forbidden (R-04)."
  fi
  # RULE B1 end

  # RULE B2 begin  (harness paths may not even be named in shell commands)
  if printf '%s' "$cmd" | grep -Eq '(\.github/|\.githooks|\.factory/|\.claude/|feature_list\.json|CODEOWNERS)'; then
    deny B2 "$cmd" "Harness files (.github, .githooks, .factory, .claude, feature_list.json, CODEOWNERS) are off limits in shell commands. Use the Read tool to read them."
  fi
  # RULE B2 end

  case "$role" in
    builder)
      # RULE B3 begin
      if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_-])(tests/|evals/|src/contracts|src/templates|src/security)'; then
        deny B3 "$cmd" "The builder may not touch tests/, evals/ or protected src/ dirs from the shell. Use the Read tool to read tests; run them with the package test script."
      fi
      # RULE B3 end
      ;;
    qa)
      # RULE B4 begin
      if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_-])src/'; then
        deny B4 "$cmd" "QA may not touch src/ from the shell. Use the Read tool to read source files."
      fi
      # RULE B4 end
      ;;
    reviewer | compliance)
      # RULE B5 begin  (read-only roles: no write-like commands)
      if printf '%s' "$scrubbed" | grep -Eq '>|(^|[;&|[:space:]])(tee|rm|mv|cp|touch|mkdir|chmod|ln|install|patch|truncate|dd)[[:space:]]|sed[[:space:]]+-i|(pnpm|npm|yarn)[[:space:]]+(add|install|i|remove)|git[[:space:]]+(checkout|apply|reset|clean|stash)'; then
        deny B5 "$cmd" "The ${role} role is read-only: no redirection or write commands. Report findings instead."
      fi
      # RULE B5 end
      ;;
    *)
      # RULE B6 begin
      deny B6 "$cmd" "Unknown role '${role}' may not run shell commands."
      # RULE B6 end
      ;;
  esac
  allow B0
}

# ---------------------------------------------------------------- main
if [ "${2:-}" = "--check" ]; then
  mode=check
  [ $# -eq 4 ] || { echo "usage: path-guard.sh <role> --check <worktree> <path>" >&2; exit 64; }
  check_path "$3" "$4"
  exit 2 # fail closed if a rule ever falls through
fi

command -v jq >/dev/null 2>&1 || deny R0 "-" "jq is missing; path-guard fails closed."
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || deny R0 "-" "hook input is not JSON; failing closed."
root=${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty')}
[ -n "$root" ] || deny R0 "-" "no project dir or cwd in hook input; failing closed."

case "$tool" in
  Write | Edit | MultiEdit)
    p=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    [ -n "$p" ] || deny R0 "-" "no file_path in tool input."
    check_path "$root" "$p"
    ;;
  NotebookEdit)
    p=$(printf '%s' "$input" | jq -r '.tool_input.notebook_path // empty')
    [ -n "$p" ] || deny R0 "-" "no notebook_path in tool input."
    check_path "$root" "$p"
    ;;
  Bash)
    check_bash "$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    ;;
  *)
    exit 0
    ;;
esac
