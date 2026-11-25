import { spawn } from "node:child_process";
import { childEnv, type ChildKind } from "./env.ts";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  kind?: ChildKind;
  env?: Record<string, string>;
  onStdoutLine?: (line: string) => void;
}

export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Run a command with a minimal environment (R-05) and a hard timeout (R-12). Never uses a shell. */
export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: childEnv(opts.kind ?? "plain", opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      stdout += text;
      if (opts.onStdoutLine) {
        pending += text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const l of lines) opts.onStdoutLine(l);
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    child.stdin.end(opts.input ?? "");
  });
