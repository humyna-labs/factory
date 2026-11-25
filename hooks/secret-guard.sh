#!/usr/bin/env bash
# secret-guard: a small, mutation-checked secret scanner (R-16, spec 3.6 "gitleaks + hooks").
#   secret-guard.sh --hook             Claude Code PreToolUse hook: scans the text being written
#   secret-guard.sh --scan <file>...   scan files
#   secret-guard.sh --scan-git         scan every tracked file of the repo in the current dir
#   secret-guard.sh --stdin            scan stdin
# Exit 0 clean, 2 findings (hook mode blocks), 64 usage. Findings never print the secret itself.
# Each rule sits between "# RULE <id> begin/end" for hooks/test/mutation.test.ts.
# Gitleaks also runs in CI (ci/workflows/gates.yml); this script is the part we can test here.
set -u

rules() {
  # id|flags|name|extended regex
  # RULE S1 begin
  echo 'S1||private key block|-{5}BEGIN ([A-Z0-9]+ )*PRIVATE KEY-{5}'
  # RULE S1 end
  # RULE S2 begin
  echo 'S2||GitHub token|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}'
  # RULE S2 end
  # RULE S3 begin
  echo 'S3||GitHub fine-grained token|github_pat_[A-Za-z0-9_]{22,}'
  # RULE S3 end
  # RULE S4 begin
  echo 'S4||Anthropic API key|sk-ant-[A-Za-z0-9_-]{20,}'
  # RULE S4 end
  # RULE S5 begin
  echo 'S5||AWS access key id|(AKIA|ASIA)[0-9A-Z]{16}'
  # RULE S5 end
  # RULE S6 begin
  echo 'S6||Telegram bot token|[0-9]{8,10}:AA[A-Za-z0-9_-]{33}'
  # RULE S6 end
  # RULE S7 begin
  echo 'S7||Slack token|xox[abprs]-[A-Za-z0-9-]{10,}'
  # RULE S7 end
  # RULE S8 begin
  echo 'S8|i|hard-coded credential assignment|(api[_-]?key|secret|token|passw(or)?d)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_/+=.-]{20,}["'"'"']'
  # RULE S8 end
}

found=0
scan_file() { # <label> <file>
  while IFS='|' read -r id flags name re; do
    [ -n "$id" ] || continue
    opt=-EnI
    [ "$flags" = i ] && opt=-EnIi
    lines=$(grep "$opt" -- "$re" "$2" 2>/dev/null | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
    if [ -n "$lines" ]; then
      printf 'secret-guard: %s %s (%s) at %s line %s\n' "$id" "$name" "redacted" "$1" "$lines" >&2
      found=1
    fi
  done <<RULES
$(rules)
RULES
}

usage() { echo "usage: secret-guard.sh --hook | --scan <file>... | --scan-git | --stdin" >&2; exit 64; }

case "${1:-}" in
  --scan)
    shift
    [ $# -gt 0 ] || usage
    for f in "$@"; do [ -f "$f" ] && scan_file "$f" "$f"; done
    ;;
  --scan-git)
    tmp_list=$(mktemp)
    git ls-files -z >"$tmp_list" || { rm -f "$tmp_list"; echo "secret-guard: not a git repository" >&2; exit 64; }
    while IFS= read -r -d '' f; do [ -f "$f" ] && scan_file "$f" "$f"; done <"$tmp_list"
    rm -f "$tmp_list"
    ;;
  --stdin)
    tmp=$(mktemp); cat >"$tmp"; scan_file stdin "$tmp"; rm -f "$tmp"
    ;;
  --hook)
    command -v jq >/dev/null 2>&1 || { echo "secret-guard: jq missing; failing closed" >&2; exit 2; }
    tmp=$(mktemp)
    jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")' >"$tmp" 2>/dev/null \
      || { rm -f "$tmp"; echo "secret-guard: hook input is not JSON; failing closed" >&2; exit 2; }
    scan_file "tool input" "$tmp"
    rm -f "$tmp"
    [ "$found" = 0 ] || echo "Never write secrets into files (spec 3.6). Use an environment variable read by name in coordinator/src/env.ts, or ask for the capability in your report." >&2
    ;;
  *) usage ;;
esac
[ "$found" = 0 ] || exit 2
exit 0
