import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const nodeTests = configDefaults.include.map((pattern) => `tests/{core,features,scripts}/${pattern}`);
const browserTests = ["**/*.browser.{test,spec}.?(c|m)[jt]s?(x)"];
const excluded = [...configDefaults.exclude, "benchmarks/**"];

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["src/**/*.d.ts"],
      include: ["main.ts", "src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80
      }
    },
    projects: [
      { extends: true, test: {
        name: "node", environment: "node", include: nodeTests, exclude: [...excluded, ...browserTests],
      } },
      { extends: true, test: {
        name: "host", environment: "happy-dom", exclude: [...excluded, ...nodeTests, ...browserTests],
        setupFiles: ["./tests/setup/obsidian-dom.ts"],
      } },
      { extends: true, test: {
        name: "chromium", environment: "node", include: browserTests, exclude: excluded,
      } },
    ],
  },
});
