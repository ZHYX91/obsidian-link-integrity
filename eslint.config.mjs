import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const TEST_FILES = ["benchmarks/**/*.ts", "tests/**/*.ts"];
const NODE_SCRIPT_FILES = ["*.mjs", "*.mts", "scripts/**/*.mjs"];
const disabledObsidianRules = Object.fromEntries(
  Object.keys(obsidianmd.rules).map((ruleName) => [`obsidianmd/${ruleName}`, "off"]),
);
const restrictedImports = (layers, allowObsidian = false) => ["error", {
  paths: allowObsidian ? [] : [{
    name: "obsidian",
    message: "Host APIs belong in adapters or application/UI code.",
  }],
  patterns: [{
    group: layers.map((layer) => `**/${layer}/**`),
    message: "This import crosses the repository architecture boundary.",
  }],
}];

export default defineConfig([
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "release/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,mts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports([
        "adapters",
        "app",
        "features",
        "shared",
        "ui",
      ]),
    },
  },
  {
    files: ["src/features/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(["adapters", "app", "shared", "ui"]),
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(["adapters", "app", "features", "ui"]),
    },
  },
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(["app", "shared", "ui"], true),
    },
  },
  {
    files: ["src/ui/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports(["adapters", "app", "features"], true),
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: TEST_FILES,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...disabledObsidianRules,
      "@microsoft/sdl/no-inner-html": "off",
      "no-undef": "off",
      "no-unsanitized/method": "off",
      "no-unsanitized/property": "off",
      "no-restricted-globals": "off"
    },
  },
  {
    files: NODE_SCRIPT_FILES,
    languageOptions: {
      globals: {
        Buffer: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      },
    },
    rules: {
      ...disabledObsidianRules,
      "no-unsanitized/method": "off",
      "no-unsanitized/property": "off",
      "no-restricted-globals": "off"
    },
  },
]);
