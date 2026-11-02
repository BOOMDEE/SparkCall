import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsFiles = ["apps/web/src/**/*.{ts,tsx}", "workers/api/src/**/*.{ts,tsx}"];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: tsFiles,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
