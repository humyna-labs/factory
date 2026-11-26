// R-05: the ONLY module that reads process.env. Every variable is named here.
// Never print, log or stringify the environment. Never read another process's environment.

/** Variables a child process of a given kind may receive. Nothing else is passed through. */
const PASSTHROUGH = {
  // PLAYWRIGHT_BROWSERS_PATH: the image ships Chromium in /ms-playwright; without it the e2e
  // gate and every role session look in ~/.cache and fail (jd2cv-m1, first live run). Not a secret.
  base: ["PATH", "HOME", "LANG", "TZ", "PLAYWRIGHT_BROWSERS_PATH"],
  gh: ["GH_TOKEN"],
  // Claude Code authentication, if the container uses an env var instead of ~/.claude.
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
} as const;

export type ChildKind = "plain" | "gh" | "claude" | "git";

function pick(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Build the minimal environment for a child process. Never spread process.env.
 * Non-interactive switches make sure no child ever waits for input (R-12).
 */
export function childEnv(kind: ChildKind, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    ...pick(PASSTHROUGH.base),
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    CI: "1",
  };
  if (kind === "gh") Object.assign(env, pick(PASSTHROUGH.gh));
  if (kind === "claude") Object.assign(env, pick(PASSTHROUGH.claude));
  return { ...env, ...extra };
}

/** Names only, for tests and documentation. */
export function passthroughNames(kind: ChildKind): string[] {
  const names: string[] = [...PASSTHROUGH.base];
  if (kind === "gh") names.push(...PASSTHROUGH.gh);
  if (kind === "claude") names.push(...PASSTHROUGH.claude);
  return names;
}
