import { execSync } from "node:child_process";
import path from "node:path";

const backendDir = path.resolve(__dirname, "..");

// Runs once for the whole test run (vitest globalSetup), unlike setup.ts's per-file
// beforeEach/afterAll — applying migrations here instead of there avoids re-shelling out to
// `prisma migrate deploy` once per test file.
export function setup() {
  execSync("npx prisma migrate deploy", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
