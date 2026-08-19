import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoiceMath";
import { validateComputedInvoice, type ValidatableInvoice } from "./invoiceValidator";

type LineInput = Parameters<typeof computeInvoiceTotals>[0]["lines"][number];

function lineInput(overrides: Partial<LineInput> = {}): LineInput {
  return {
    description: "Test",
    quantity: 1,
    unitCode: "C62",
    unitPrice: 100,
    taxRatePercent: 23,
    ...overrides,
  };
}

function validInvoice(overrides: Partial<ValidatableInvoice> = {}): ValidatableInvoice {
  const totals = computeInvoiceTotals({ lines: [lineInput()] });
  return {
    supplierDic: "1111111111",
    supplierIcDph: "SK1111111111",
    customerDic: "2222222222",
    buyerReference: "OBJ-1",
    lines: totals.lines,
    netAmountCents: totals.netAmountCents,
    taxAmountCents: totals.taxAmountCents,
    grossAmountCents: totals.grossAmountCents,
    taxBreakdown: totals.taxBreakdown,
    ...overrides,
  };
}

describe("validateComputedInvoice", () => {
  it("accepts a well-formed invoice", () => {
    const result = validateComputedInvoice(validInvoice());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects supplier and customer sharing the same DIČ", () => {
    const result = validateComputedInvoice(validInvoice({ supplierDic: "1234567890", customerDic: "1234567890" }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/rovnaké DIČ/);
  });

  it("rejects a missing buyer reference (PEPPOL-EN16931-R003)", () => {
    const result = validateComputedInvoice(validInvoice({ buyerReference: "  " }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/referencia objednávateľa/);
  });

  it("rejects a standard-rate line when the supplier has no IČ DPH", () => {
    const totals = computeInvoiceTotals({ lines: [lineInput({ taxRatePercent: 23 })] });
    const result = validateComputedInvoice(
      validInvoice({
        supplierIcDph: null,
        lines: totals.lines,
        netAmountCents: totals.netAmountCents,
        taxAmountCents: totals.taxAmountCents,
        grossAmountCents: totals.grossAmountCents,
        taxBreakdown: totals.taxBreakdown,
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/nie je platca DPH/);
  });

  it("accepts a 0% line for a supplier with no IČ DPH — KNOWN GAP, see WP0 handoff", () => {
    // The official KOSIT/Peppol Schematron rejects this with BR-Z-02: a "Zero rated" (category
    // Z) line still requires the Seller VAT Identifier. This validator does not yet enforce
    // that — reported to the project owner rather than silently "fixed" here (WP0 rule: don't
    // guess at tax logic). If/when that's resolved, this test's expectation should flip to
    // `result.valid === false` and a fixture should be added exercising it.
    const totals = computeInvoiceTotals({ lines: [lineInput({ taxRatePercent: 0 })] });
    const result = validateComputedInvoice(
      validInvoice({
        supplierIcDph: null,
        lines: totals.lines,
        netAmountCents: totals.netAmountCents,
        taxAmountCents: totals.taxAmountCents,
        grossAmountCents: totals.grossAmountCents,
        taxBreakdown: totals.taxBreakdown,
      })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a negative-amount line", () => {
    const totals = computeInvoiceTotals({ lines: [lineInput()] });
    const negativeLine = { ...totals.lines[0], lineNetCents: -500 };
    const result = validateComputedInvoice(validInvoice({ lines: [negativeLine] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/zápornú sumu/);
  });

  it("reconciles mixed rates in one invoice without a false-positive BR-CO error", () => {
    const totals = computeInvoiceTotals({
      lines: [lineInput({ unitPrice: 100, taxRatePercent: 23 }), lineInput({ unitPrice: 50, taxRatePercent: 5 })],
    });
    const result = validateComputedInvoice(
      validInvoice({
        lines: totals.lines,
        netAmountCents: totals.netAmountCents,
        taxAmountCents: totals.taxAmountCents,
        grossAmountCents: totals.grossAmountCents,
        taxBreakdown: totals.taxBreakdown,
      })
    );
    expect(result.valid).toBe(true);
  });

  it("warns (but does not reject) an unusually large invoice", () => {
    const totals = computeInvoiceTotals({ lines: [lineInput({ unitPrice: 2_000_000, taxRatePercent: 0 })] });
    const result = validateComputedInvoice(
      validInvoice({
        lines: totals.lines,
        netAmountCents: totals.netAmountCents,
        taxAmountCents: totals.taxAmountCents,
        grossAmountCents: totals.grossAmountCents,
        taxBreakdown: totals.taxBreakdown,
      })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
