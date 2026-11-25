#!/usr/bin/env bash
# session-start (BL-01, W2-08, R-21, P-06): Claude Code SessionStart hook. Injects the task's
# progress.md (tail, 8 KiB) and the titles of open escalations as additionalContext, so a long or
# resumed task starts from recorded state instead of memory. Never fails the session.
# Reads the hook JSON on stdin (.cwd). FACTORY_ESCALATIONS_DIR comes from the coordinator.
# Rules sit between "# RULE <id> begin/end" for hooks/test/session-hooks.test.ts.
set -u
input=$(cat)
root=${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}
esc=${FACTORY_ESCALATIONS_DIR:-/workspace/runs/escalations}
ctx=""

# RULE H1 begin  (progress.md of the task worktree; never through a symlink, W2-03)
if [ -n "$root" ] && [ -f "$root/progress.md" ] && [ ! -L "$root/progress.md" ]; then
  ctx="## progress.md (latest entries)
$(tail -c 8192 "$root/progress.md")"
fi
# RULE H1 end

# RULE H2 begin  (open escalations: titles only, at most 20)
titles=""
n=0
for f in "$esc"/*.md; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  t=$(grep -m 1 '^# ' "$f" | cut -c 3-200 | tr -c '\n -~' '?')
  [ -n "$t" ] || continue
  titles="${titles}- ${t}
"
  n=$((n + 1))
  [ "$n" -lt 20 ] || break
done
if [ -n "$titles" ]; then
  ctx="${ctx}${ctx:+

}## Open escalations (read before repeating a failed approach)
${titles}"
fi
# RULE H2 end

[ -n "$ctx" ] || exit 0
if command -v jq >/dev/null 2>&1; then
  jq -n --arg c "$ctx" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
else
  printf '%s\n' "$ctx"
fi
exit 0
