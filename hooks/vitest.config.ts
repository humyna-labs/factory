// Verifier P9: fail the run if any test touched the real /workspace/runs/guard.log.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { globalSetup: ["./test/guard-log-untouched.ts"] } });
