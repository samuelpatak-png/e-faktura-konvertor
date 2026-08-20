import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runKositValidation } from "./kositRunner";

const fixturesDir = join(__dirname, "../../test/fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

// The local KOSIT toolchain (backend/tools/kosit/) is gitignored and only downloaded on
// demand (scripts/setup-kosit.sh) — it deliberately isn't present when `npm test` runs in CI
// (that happens before the Java/KOSIT setup steps, see .github/workflows/ci.yml), so this
// module must degrade gracefully rather than assume it's there. These tests verify the result
// shape always holds, and additionally exercise the real validator end-to-end whenever the
// toolchain happens to be present (as it is in local dev after `npm run setup:kosit`).
describe("runKositValidation", () => {
  it("always returns a well-shaped result, whether or not the local toolchain is installed", async () => {
    const result = await runKositValidation(loadFixture("domestic-23-standard.xml"));
    expect(typeof result.available).toBe("boolean");
    if (!result.available) {
      expect(result.acceptable).toBeNull();
      expect(result.messages).toEqual([]);
    }
  });

  it("accepts a known-good fixture when the toolchain is available", async () => {
    const result = await runKositValidation(loadFixture("domestic-23-standard.xml"));
    if (!result.available) return; // nothing to assert without the toolchain — see note above
    expect(result.acceptable).toBe(true);
  });

  it("rejects a document missing BuyerReference, with a supplementary message, when the toolchain is available", async () => {
    const broken = loadFixture("domestic-23-standard.xml").replace(/<cbc:BuyerReference>[^<]*<\/cbc:BuyerReference>/, "");
    const result = await runKositValidation(broken);
    if (!result.available) return;
    expect(result.acceptable).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.includes("PEPPOL-EN16931-R003"))).toBe(true);
  });

  it("never throws on garbage input, even when the toolchain is available", async () => {
    await expect(runKositValidation("not xml at all")).resolves.toBeDefined();
  });
});
