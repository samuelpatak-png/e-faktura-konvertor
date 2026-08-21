import { describe, expect, it } from "vitest";
import { centsToEur, computeInvoiceTotals, eurToCents, formatEurCents, taxBreakdownFromLines } from "./invoiceMath";

type LineInput = Parameters<typeof computeInvoiceTotals>[0]["lines"][number];

function line(overrides: Partial<LineInput> = {}): LineInput {
  return {
    description: "Test",
    quantity: 1,
    unitCode: "C62",
    unitPrice: 100,
    taxRatePercent: 23,
    ...overrides,
  };
}

describe("eurToCents / centsToEur", () => {
  it("round-trips a whole-cent amount exactly", () => {
    expect(eurToCents(19.99)).toBe(1999);
    expect(centsToEur(1999)).toBe(19.99);
  });

  it("rounds half-up on the rare case a caller passes sub-cent precision", () => {
    expect(eurToCents(0.125)).toBe(13);
  });
});

describe("computeInvoiceTotals", () => {
  it("computes a zero-amount line without error", () => {
    const totals = computeInvoiceTotals({ lines: [line({ unitPrice: 0 })] });
    expect(totals.netAmountCents).toBe(0);
    expect(totals.taxAmountCents).toBe(0);
    expect(totals.grossAmountCents).toBe(0);
  });

  it("computes a 0% VAT line with no tax", () => {
    const totals = computeInvoiceTotals({ lines: [line({ unitPrice: 100, taxRatePercent: 0 })] });
    expect(totals.netAmountCents).toBe(10000);
    expect(totals.taxAmountCents).toBe(0);
    expect(totals.grossAmountCents).toBe(10000);
    expect(totals.taxBreakdown).toEqual([{ taxRatePercent: 0, taxableAmountCents: 10000, taxAmountCents: 0 }]);
  });

  it("groups mixed rates within one invoice into separate tax categories that reconcile exactly", () => {
    const totals = computeInvoiceTotals({
      lines: [
        line({ unitPrice: 100, taxRatePercent: 23 }),
        line({ unitPrice: 50, taxRatePercent: 19 }),
        line({ unitPrice: 20, taxRatePercent: 5 }),
      ],
    });
    expect(totals.taxBreakdown).toHaveLength(3);
    const byRate = Object.fromEntries(totals.taxBreakdown.map((b) => [b.taxRatePercent, b]));
    expect(byRate[23]).toEqual({ taxRatePercent: 23, taxableAmountCents: 10000, taxAmountCents: 2300 });
    expect(byRate[19]).toEqual({ taxRatePercent: 19, taxableAmountCents: 5000, taxAmountCents: 950 });
    expect(byRate[5]).toEqual({ taxRatePercent: 5, taxableAmountCents: 2000, taxAmountCents: 100 });

    // BR-CO-14/15 by construction: grand totals equal the sum of the category breakdown.
    const sumTaxable = totals.taxBreakdown.reduce((s, b) => s + b.taxableAmountCents, 0);
    const sumTax = totals.taxBreakdown.reduce((s, b) => s + b.taxAmountCents, 0);
    expect(sumTaxable).toBe(totals.netAmountCents);
    expect(sumTax).toBe(totals.taxAmountCents);
    expect(totals.netAmountCents + totals.taxAmountCents).toBe(totals.grossAmountCents);
  });

  it("does not compound rounding error from unit price into the line total (regression: WP-prior overcharge bug)", () => {
    // unitPrice=0.125 rounds to 13 cents in isolation, but the line net must come from the
    // full-precision unitPrice × quantity, not from re-multiplying the already-rounded cents.
    const totals = computeInvoiceTotals({ lines: [line({ quantity: 1000, unitPrice: 0.125, taxRatePercent: 0 })] });
    expect(totals.netAmountCents).toBe(12500); // 125.00 €, not 130.00 €
  });

  it("sums multiple lines at the same rate into a single tax category", () => {
    const totals = computeInvoiceTotals({
      lines: [line({ unitPrice: 10, taxRatePercent: 23 }), line({ unitPrice: 5, taxRatePercent: 23 })],
    });
    expect(totals.taxBreakdown).toEqual([{ taxRatePercent: 23, taxableAmountCents: 1500, taxAmountCents: 345 }]);
  });

  // Negative amounts are rejected at the Zod boundary (validators/schemas.ts: unitPrice is
  // .nonnegative()) before reaching this function — see schemas.test.ts for that case.
  // computeInvoiceTotals itself does not defensively re-check, matching the rest of the
  // codebase's "validate at the boundary, trust internally" pattern.
});

describe("taxBreakdownFromLines", () => {
  it("regroups persisted (already-in-cents) lines the same way computeInvoiceTotals groups fresh input", () => {
    const breakdown = taxBreakdownFromLines([
      { taxRatePercent: 23, lineNetCents: 10000 },
      { taxRatePercent: 19, lineNetCents: 5000 },
      { taxRatePercent: 23, lineNetCents: 2000 },
    ]);
    expect(breakdown).toEqual([
      { taxRatePercent: 23, taxableAmountCents: 12000, taxAmountCents: 2760 },
      { taxRatePercent: 19, taxableAmountCents: 5000, taxAmountCents: 950 },
    ]);
  });

  it("returns an empty array for no lines", () => {
    expect(taxBreakdownFromLines([])).toEqual([]);
  });
});

describe("formatEurCents", () => {
  it("formats whole euros with two decimal places", () => {
    expect(formatEurCents(12300)).toContain("123,00");
  });

  it("formats a sub-euro amount correctly", () => {
    expect(formatEurCents(50)).toContain("0,50");
  });

  it("formats zero", () => {
    expect(formatEurCents(0)).toContain("0,00");
  });

  it("includes the euro sign", () => {
    expect(formatEurCents(100)).toContain("€");
  });

  it("uses a comma as the decimal separator (sk-SK locale)", () => {
    expect(formatEurCents(199)).toContain("1,99");
    expect(formatEurCents(199)).not.toContain("1.99");
  });
});
