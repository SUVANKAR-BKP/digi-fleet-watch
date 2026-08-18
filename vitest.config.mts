import { defineConfig } from "vitest/config";

/**
 * Without this config Vitest had no idea what "@/..." meant, so every test file
 * failed to import and the suite reported "no tests" while exiting non-zero —
 * the regression guards in src/lib/*.test.ts were never actually running.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
