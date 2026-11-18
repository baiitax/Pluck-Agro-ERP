import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "database",
          environment: "node",
          include: ["tests/database/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          pool: "forks",
          fileParallelism: false,
        },
      },
    ],
  },
});
