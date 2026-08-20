import { describe, expect, it } from "vitest";
import { validateParsedDocument } from "./receivedInvoiceValidator";
import type { ParsedUblDocument } from "./ublParser";

function validDoc(overrides: Partial<ParsedUblDocument> = {}): ParsedUblDocument {
  return {
    documentType: "INVOICE",
    number: "F-1",
    issueDate: "2026-08-20",
    dueDate: "2026-09-03",
    currency: "EUR",
    buyerReference: "OBJ-1",
    supplier: { name: "Dodávateľ", ico: "11111111", dic: "1111111111", icDph: null, street: "A", city: "B", postalCode: "81101", country: "SK" },
    customer: { name: "Odberateľ", ico: null, dic: "2222222222", icDph: null, street: "C", city: "D", postalCode: "04001", country: "SK" },
    lines: [{ description: "Položka", quantity: 1, unitCode: "C62", unitPriceCents: 10000, taxRatePercent: 23, lineNetCents: 10000 }],
    netAmountCents: 10000,
    taxAmountCents: 2300,
    grossAmountCents: 12300,
    ...overrides,
  };
}

describe("validateParsedDocument", () => {
  it("accepts a well-formed document", () => {
    const result = validateParsedDocument(validDoc());
    expect(result.errors).toEqual([]);
  });

  it("errors when the supplier has no identifiable DIČ/Peppol ID", () => {
    const result = validateParsedDocument(validDoc({ supplier: { ...validDoc().supplier, dic: null } }));
    expect(result.errors.join(" ")).toMatch(/identifikátor dodávateľa/);
  });

  it("errors when there are no lines", () => {
    const result = validateParsedDocument(validDoc({ lines: [] }));
    expect(result.errors.join(" ")).toMatch(/žiadne položky/);
  });

  it("errors when net + tax doesn't reconcile with gross", () => {
    const result = validateParsedDocument(validDoc({ grossAmountCents: 99999999 }));
    expect(result.errors.join(" ")).toMatch(/nezodpovedá celkovej sume/);
  });

  it("warns (does not error) on a negative line amount", () => {
    const doc = validDoc({ lines: [{ description: "Storno", quantity: 1, unitCode: "C62", unitPriceCents: -1000, taxRatePercent: 0, lineNetCents: -1000 }], netAmountCents: -1000, taxAmountCents: 0, grossAmountCents: -1000 });
    const result = validateParsedDocument(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/zápornú sumu/);
  });

  it("warns on a zero total", () => {
    const result = validateParsedDocument(validDoc({ grossAmountCents: 0, netAmountCents: 0, taxAmountCents: 0, lines: [{ description: "X", quantity: 1, unitCode: "C62", unitPriceCents: 0, taxRatePercent: 0, lineNetCents: 0 }] }));
    expect(result.warnings.join(" ")).toMatch(/nulová/);
  });
});
