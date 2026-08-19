import { describe, expect, it } from "vitest";
import { invoiceLineSchema } from "./schemas";

const base = {
  description: "Test",
  quantity: 1,
  unitCode: "C62" as const,
  unitPrice: 10,
  taxRatePercent: 23 as const,
};

describe("invoiceLineSchema", () => {
  it("accepts a 0% VAT rate", () => {
    const result = invoiceLineSchema.safeParse({ ...base, taxRatePercent: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects a negative unit price", () => {
    const result = invoiceLineSchema.safeParse({ ...base, unitPrice: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(invoiceLineSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(invoiceLineSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
  });

  it("accepts a whole-euro and a 2-decimal unit price", () => {
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10 }).success).toBe(true);
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10.5 }).success).toBe(true);
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10.55 }).success).toBe(true);
  });

  it("rejects a unit price with more than 2 decimal places (prior overcharge-bug regression)", () => {
    const result = invoiceLineSchema.safeParse({ ...base, unitPrice: 0.125 });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported VAT rate", () => {
    // zod's .safeParse accepts unknown input at compile time — this is a runtime check.
    const result = invoiceLineSchema.safeParse({ ...base, taxRatePercent: 21 });
    expect(result.success).toBe(false);
  });
});
