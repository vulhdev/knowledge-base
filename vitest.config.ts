import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/tools/**"],
      reporter: ["text"],
      thresholds: { lines: 80 },
    },
  },
});
