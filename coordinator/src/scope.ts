// Second layer of R-03: after every session, each changed path goes through the same
// hooks/path-guard.sh that blocked tool calls during the session. One policy, two checkpoints.
import type { Exec } from "./exec.ts";
import { factoryPath } from "./paths.ts";
import type { Role } from "./types.ts";

export const PATH_GUARD = factoryPath("hooks", "path-guard.sh");

export async function outOfScope(run: Exec, role: Role, worktree: string, files: string[], grants: readonly string[] = []): Promise<string[]> {
  const denied: string[] = [];
  const env = role === "builder" && grants.length ? { FACTORY_GRANTS: grants.join(",") } : undefined;
  for (const f of files) {
    const r = await run(PATH_GUARD, [role, "--check", worktree, f], { timeoutMs: 10_000, ...(env ? { env } : {}) });
    if (r.code !== 0) denied.push(f);
  }
  return denied;
}
