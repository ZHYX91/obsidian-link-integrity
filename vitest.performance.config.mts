import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)) } },
  define: {
    "process.env.LINK_INTEGRITY_BENCHMARK_MODE": JSON.stringify(mode),
  },
  test: {
    include: ["benchmarks/**/*.test.ts"],
    testTimeout: 120_000,
  },
}));
