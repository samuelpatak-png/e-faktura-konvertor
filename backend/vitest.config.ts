import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Dedicated SQLite file so controller/DB tests never touch dev.db. Must be set before
      // src/lib/prisma.ts (or src/lib/env.ts) is imported by any test module.
      DATABASE_URL: "file:./test.db",
    },
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    // Tests share one SQLite file and reset tables in beforeEach — concurrent test files would
    // race on that reset.
    fileParallelism: false,
  },
});
