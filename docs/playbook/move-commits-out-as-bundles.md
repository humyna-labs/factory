# Move commits out of an agent-writable checkout as a bundle, never by running git there

When: commits made in the container (or any checkout an agent can write) must reach GitHub through
the owner's host credentials.

How:
- Never run git on the host inside the bind-mounted checkout: its `.git/config` and hooks are
  agent-writable, and `git status` there ran a configured `core.fsmonitor` and a hook (verifier P1, git 2.39).
- The agent writes `git bundle create /workspace/runs/<name>.bundle <branch>` and reports the SHA.
- The owner fetches it into a reviewed clone outside the mount
  (`git fetch <bundle> <branch>:<branch>`), compares `git rev-parse <branch>` with the reported SHA, then pushes.
- Reviewed clones live at `~/ai-projects/<repo>-reviewed`, so the owner's noreply identity applies.

Evidence: resume-sg H-04 on 2026-11-25 (commit `95a5a79` from `/workspace/runs/resume-sg-main.bundle`);
`docs/runbook.md` "Moving commits out of the container". Principles: G-07, P-11.
