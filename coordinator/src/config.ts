// .factory/factory.yaml schema. Single source of truth; the JSON Schema in
// templates/product/.factory/factory.schema.json is generated from it (test/config.test.ts).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { DEFAULT_MAX_IMPL_ATTEMPTS } from "./state.ts";

const repoSlug = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "owner/name");

export const FactoryConfigSchema = z
  .object({
    version: z.literal(1),
    product: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    repo: repoSlug,
    factory_repo: repoSlug.default("humyna-labs/factory"),
    base_branch: z.string().default("main"),
    max_impl_attempts: z.number().int().min(1).max(10).default(DEFAULT_MAX_IMPL_ATTEMPTS),
    session_timeout_minutes: z.number().int().min(1).max(240).default(45),
    high_risk_paths: z.array(z.string().min(1)).min(1),
    gates: z
      .object({
        typecheck: z.string(),
        lint: z.string(),
        unit: z.string(),
        e2e: z.string(),
      })
      .strict(),
    red_gate: z.enum(["unit", "e2e"]).default("unit"),
    deploy: z
      .object({
        provider: z.literal("cloudflare-pages"),
        mode: z.literal("git-integration"),
        output_dir: z.string().default("dist"),
      })
      .strict(),
  })
  .strict();

export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;

export function parseFactoryConfig(text: string): FactoryConfig {
  return FactoryConfigSchema.parse(parse(text));
}

export function loadFactoryConfig(path: string): FactoryConfig {
  return parseFactoryConfig(readFileSync(path, "utf8"));
}

export function factoryConfigJsonSchema(): unknown {
  return z.toJSONSchema(FactoryConfigSchema, { io: "input" });
}
