import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Dedicated SQLite file so controller/DB tests never touch dev.db. Must be set before
      // src/lib/prisma.ts (or src/lib/env.ts) is imported by any test module.
      DATABASE_URL: "file:./test.db",
      // Fake but schema-valid — some controllers transitively import lib/env.ts (e.g. via
      // sapiSkClient -> lib/crypto), which calls process.exit(1) if these are missing. Tests
      // must not depend on a real backend/.env existing (it's gitignored and absent in CI) —
      // this is what actually broke CI here the first time.
      JWT_SECRET: "test-only-jwt-secret-not-for-production-use-1234567890",
      CREDENTIAL_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
    },
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    // Tests share one SQLite file and reset tables in beforeEach — concurrent test files would
    // race on that reset.
    fileParallelism: false,
  },
});
