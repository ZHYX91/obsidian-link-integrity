import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  define: {
    "process.env.LINK_INTEGRITY_BENCHMARK_MODE": JSON.stringify(mode),
  },
  test: {
    include: ["benchmarks/**/*.test.ts"],
    testTimeout: 120_000,
  },
}));
