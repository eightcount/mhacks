import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // TypeScript builds include tests in dist; execute the source suite once.
    include: ["tests/**/*.test.ts"],
  },
});
