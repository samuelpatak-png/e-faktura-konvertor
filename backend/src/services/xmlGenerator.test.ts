import { describe, expect, it } from "vitest";
import { generateCreditNoteXml, generateInvoiceXml, type PartyDetails } from "./xmlGenerator";
import type { ComputedLine, TaxCategoryBreakdown } from "./invoiceMath";

const supplier: PartyDetails & { iban: string; bic?: string | null } = {
  name: "Dodávateľ s.r.o.",
  ico: "11111111",
  dic: "1111111111",
  icDph: "SK1111111111",
  street: "Ulica 1",
  city: "Bratislava",
  postalCode: "81101",
  country: "SK",
  iban: "SK9711000000002612345678",
};

const customer: PartyDetails = {
  name: "Odberateľ s.r.o.",
  dic: "2222222222",
  street: "Ulica 2",
  city: "Košice",
  postalCode: "04001",
  country: "SK",
};

const lines: ComputedLine[] = [
  { sortOrder: 0, description: "Položka", quantity: 1, unitCode: "C62", unitPriceCents: 10000, taxRatePercent: 23, lineNetCents: 10000 },
];
const taxBreakdown: TaxCategoryBreakdown[] = [{ taxRatePercent: 23, taxableAmountCents: 10000, taxAmountCents: 2300 }];

describe("generateCreditNoteXml", () => {
  const xml = generateCreditNoteXml({
    number: "DB-2026-0001",
    issueDate: "2026-08-20",
    originalInvoiceNumber: "2026-0001",
    originalInvoiceIssueDate: "2026-08-01",
    buyerReference: "OBJ-1",
    currency: "EUR",
    supplier,
    customer,
    lines,
    netAmountCents: 10000,
    taxAmountCents: 2300,
    grossAmountCents: 12300,
    taxBreakdown,
  });

  it("uses the CreditNote-2 root element and namespace, not Invoice-2", () => {
    expect(xml).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
  });

  it("uses the same CustomizationID/ProfileID as an invoice", () => {
    expect(xml).toContain("urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
    expect(xml).toContain("urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
  });

  it("sets CreditNoteTypeCode to 381", () => {
    expect(xml).toMatch(/<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  });

  it("has no DueDate element (CreditNoteType doesn't define one)", () => {
    expect(xml).not.toContain("cbc:DueDate");
  });

  it("references the original invoice via BillingReference/InvoiceDocumentReference", () => {
    expect(xml).toContain("<cac:BillingReference>");
    expect(xml).toContain("<cac:InvoiceDocumentReference>");
    expect(xml).toMatch(/<cbc:ID>2026-0001<\/cbc:ID>/);
    expect(xml).toMatch(/<cbc:IssueDate>2026-08-01<\/cbc:IssueDate>/);
  });

  it("uses CreditNoteLine/CreditedQuantity, not InvoiceLine/InvoicedQuantity", () => {
    expect(xml).toContain("<cac:CreditNoteLine>");
    expect(xml).toContain("cbc:CreditedQuantity");
    expect(xml).not.toContain("cac:InvoiceLine>");
    expect(xml).not.toContain("cbc:InvoicedQuantity");
  });
});

describe("generateInvoiceXml — WP4 additions", () => {
  const base = {
    number: "2026-0002",
    issueDate: "2026-08-20",
    dueDate: "2026-09-03",
    buyerReference: "OBJ-1",
    currency: "EUR",
    supplier,
    customer,
    lines,
    netAmountCents: 10000,
    taxAmountCents: 2300,
    grossAmountCents: 12300,
    taxBreakdown,
  };

  it("defaults to InvoiceTypeCode 380", () => {
    expect(generateInvoiceXml(base)).toMatch(/<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);
  });

  it("uses InvoiceTypeCode 386 for an advance tax document, still as a plain Invoice-2 document", () => {
    const xml = generateInvoiceXml({ ...base, invoiceTypeCode: "386" });
    expect(xml).toMatch(/<cbc:InvoiceTypeCode>386<\/cbc:InvoiceTypeCode>/);
    expect(xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
  });

  it("includes PrepaidAmount before PayableAmount and reduces PayableAmount by it", () => {
    const xml = generateInvoiceXml({ ...base, prepaidAmountCents: 5000 });
    const prepaidIndex = xml.indexOf("cbc:PrepaidAmount");
    const payableIndex = xml.indexOf("cbc:PayableAmount");
    expect(prepaidIndex).toBeGreaterThan(-1);
    expect(prepaidIndex).toBeLessThan(payableIndex);
    expect(xml).toMatch(/<cbc:PrepaidAmount currencyID="EUR">50\.00<\/cbc:PrepaidAmount>/);
    expect(xml).toMatch(/<cbc:PayableAmount currencyID="EUR">73\.00<\/cbc:PayableAmount>/);
  });

  it("omits PrepaidAmount entirely when there is no prepayment", () => {
    expect(generateInvoiceXml(base)).not.toContain("PrepaidAmount");
  });

  it("carries prepaidReference as a Note", () => {
    const xml = generateInvoiceXml({ ...base, prepaidAmountCents: 5000, prepaidReference: "Preddavok DP-2026-0001" });
    expect(xml).toMatch(/<cbc:Note>Preddavok DP-2026-0001<\/cbc:Note>/);
  });
});
