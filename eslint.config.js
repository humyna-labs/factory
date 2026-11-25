// Shared flat config for every workspace package. Principles: P-05.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "templates/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "R-05: read environment variables only in coordinator/src/env.ts, by name. Import a helper from there instead.",
        },
      ],
    },
  },
  {
    // Tests may pass PATH to the child processes they spawn.
    files: ["coordinator/src/env.ts", "**/test/**/*.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
