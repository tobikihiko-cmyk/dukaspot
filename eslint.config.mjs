import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "apps/web/.next/**",
      "apps/web/dist/**",
      "apps/api/dist/**",
      "apps/worker/dist/**",
      "packages/*/dist/**",
      "**/*.d.ts",
      "package-lock.json"
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        Buffer: "readonly",
        FileReader: "readonly",
        URL: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        window: "readonly",
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
];
