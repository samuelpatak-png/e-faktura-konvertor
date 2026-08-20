import { describe, expect, it } from "vitest";
import { isValidUnitCode, UNIT_CODES } from "./unitCodes";

describe("isValidUnitCode", () => {
  it("accepts every code in the exported UNIT_CODES list", () => {
    for (const { code } of UNIT_CODES) {
      expect(isValidUnitCode(code)).toBe(true);
    }
  });

  it("rejects an unknown code", () => {
    expect(isValidUnitCode("NOT_A_REAL_CODE")).toBe(false);
  });

  it("is case-sensitive (UBL unitCode values are uppercase)", () => {
    expect(isValidUnitCode("hur")).toBe(false);
    expect(isValidUnitCode("HUR")).toBe(true);
  });

  it("has no duplicate codes", () => {
    const codes = UNIT_CODES.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
