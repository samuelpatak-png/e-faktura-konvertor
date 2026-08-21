import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUblDocument, UblParseError } from "./ublParser";

const fixturesDir = join(__dirname, "../../test/fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("parseUblDocument — security (do not weaken these without re-verifying by hand)", () => {
  it("refuses a classic XXE payload attempting to read a local file, and never leaks its content", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE Invoice [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">&xxe;</cbc:ID>
</Invoice>`;
    expect(() => parseUblDocument(xxe)).toThrow(UblParseError);
    try {
      parseUblDocument(xxe);
    } catch (err) {
      expect(String(err)).not.toContain("root:");
    }
  });

  it("does not hang or blow up memory on a billion-laughs entity-expansion payload", () => {
    const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<Invoice><cbc:ID>&lol3;</cbc:ID></Invoice>`;
    const start = Date.now();
    expect(() => parseUblDocument(billionLaughs)).toThrow(UblParseError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("rejects a file larger than the size limit before ever handing it to the XML parser", () => {
    const huge = "<Invoice>" + "x".repeat(6 * 1024 * 1024) + "</Invoice>";
    expect(() => parseUblDocument(huge)).toThrow(/príliš veľký/);
  });
});

describe("parseUblDocument — malformed input", () => {
  it("rejects non-XML garbage", () => {
    expect(() => parseUblDocument("this is not xml at all { }")).toThrow(UblParseError);
  });

  it("rejects XML with neither an Invoice nor a CreditNote root", () => {
    expect(() => parseUblDocument("<SomethingElse><cbc:ID>1</cbc:ID></SomethingElse>")).toThrow(/Invoice.*CreditNote/);
  });

  it("rejects a document missing ID or IssueDate", () => {
    expect(() => parseUblDocument("<Invoice><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode></Invoice>")).toThrow(UblParseError);
  });
});

describe("parseUblDocument — real fixtures", () => {
  it("round-trips our own domestic-23-standard.xml invoice fixture correctly", () => {
    const parsed = parseUblDocument(loadFixture("domestic-23-standard.xml"));
    expect(parsed.documentType).toBe("INVOICE");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.supplier.dic).toBeTruthy();
    expect(parsed.customer.dic).toBeTruthy();
    expect(parsed.grossAmountCents).toBeGreaterThan(0);
    expect(parsed.grossAmountCents).toBe(parsed.netAmountCents + parsed.taxAmountCents);
  });

  it("round-trips mixed-rates.xml with multiple lines, preserving each line's own rate", () => {
    const parsed = parseUblDocument(loadFixture("mixed-rates.xml"));
    expect(parsed.lines.length).toBeGreaterThan(1);
    const rates = new Set(parsed.lines.map((l) => l.taxRatePercent));
    expect(rates.size).toBeGreaterThan(1);
  });

  it("round-trips a single-line invoice without the array/object fast-xml-parser gotcha", () => {
    // A lone <cac:InvoiceLine> parses as an object, not a length-1 array — parseUblDocument
    // must normalize this or it would silently produce zero lines.
    const parsed = parseUblDocument(loadFixture("single-line-minimal.xml"));
    expect(parsed.lines).toHaveLength(1);
  });

  it("preserves a leading-zero PSČ as a string, not a number that lost its leading zero", () => {
    const parsed = parseUblDocument(loadFixture("domestic-23-standard.xml"));
    if (parsed.supplier.postalCode) {
      expect(typeof parsed.supplier.postalCode).toBe("string");
    }
  });

  it("parses our own generated credit note as documentType CREDIT_NOTE with CreditedQuantity lines", () => {
    const parsed = parseUblDocument(loadFixture("credit-note.xml"));
    expect(parsed.documentType).toBe("CREDIT_NOTE");
    expect(parsed.lines.length).toBeGreaterThan(0);
    expect(parsed.lines[0].quantity).toBeGreaterThan(0);
  });

  it("parses an advance tax document (InvoiceTypeCode 386) as a normal INVOICE document type", () => {
    const parsed = parseUblDocument(loadFixture("advance-tax-document.xml"));
    expect(parsed.documentType).toBe("INVOICE");
    expect(parsed.number).toBeTruthy();
  });

  it("computes grossAmountCents from TaxInclusiveAmount (the full document total), not the prepayment-reduced PayableAmount", () => {
    // invoice-with-prepayment.xml: net 500.00, tax 115.00, TaxInclusiveAmount 615.00,
    // PrepaidAmount 200.00, PayableAmount 415.00. Using PayableAmount as "gross" would make
    // net+tax (615.00) disagree with gross (415.00) and fail our own cross-checks.
    const parsed = parseUblDocument(loadFixture("invoice-with-prepayment.xml"));
    expect(parsed.netAmountCents).toBe(50000);
    expect(parsed.taxAmountCents).toBe(11500);
    expect(parsed.grossAmountCents).toBe(61500);
    expect(parsed.netAmountCents + parsed.taxAmountCents).toBe(parsed.grossAmountCents);
  });
});

describe("parseUblDocument — multi-occurrence elements that are usually singular", () => {
  const partyBlock = (dic: string, name: string, extraPartyTaxSchemes: string[] = []) => `
    <cac:Party>
      <cbc:EndpointID schemeID="0245">${dic}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${name}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Ulica 1</cbc:StreetName>
        <cbc:CityName>Bratislava</cbc:CityName>
        <cbc:PostalZone>81101</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>SK</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${extraPartyTaxSchemes.join("\n")}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${name}</cbc:RegistrationName>
        <cbc:CompanyID>11111111</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>`;

  function invoiceXml({ taxTotals, supplierExtraSchemes = [] }: { taxTotals: string; supplierExtraSchemes?: string[] }): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-MULTI-1</cbc:ID>
  <cbc:IssueDate>2026-08-20</cbc:IssueDate>
  <cbc:DueDate>2026-09-03</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>OBJ-1</cbc:BuyerReference>
  <cac:AccountingSupplierParty>${partyBlock("1111111111", "Dodávateľ s.r.o.", supplierExtraSchemes)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${partyBlock("2222222222", "Odberateľ s.r.o.")}</cac:AccountingCustomerParty>
  ${taxTotals}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">123.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">123.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Položka</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>23.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">100.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
  }

  // A second cac:TaxTotal for a tax currency alongside the document currency (BG-13) is legal
  // UBL — before this fix it made the object auto-array under the hood, which broke the plain
  // `child(doc, "cac:TaxTotal")` single-node lookup and silently produced taxAmountCents = 0.
  it("uses the first (document-currency) TaxTotal's TaxAmount when a second TaxTotal is present", () => {
    const xml = invoiceXml({
      taxTotals: `
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="EUR">23.00</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="EUR">23.00</cbc:TaxAmount>
            <cac:TaxCategory>
              <cbc:ID>S</cbc:ID>
              <cbc:Percent>23.00</cbc:Percent>
              <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="USD">25.30</cbc:TaxAmount>
        </cac:TaxTotal>`,
    });
    const parsed = parseUblDocument(xml);
    expect(parsed.taxAmountCents).toBe(2300);
    expect(parsed.grossAmountCents).toBe(12300);
  });

  it("still works with the ordinary single-TaxTotal case", () => {
    const xml = invoiceXml({
      taxTotals: `
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="EUR">23.00</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="EUR">23.00</cbc:TaxAmount>
            <cac:TaxCategory>
              <cbc:ID>S</cbc:ID>
              <cbc:Percent>23.00</cbc:Percent>
              <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>`,
    });
    expect(parseUblDocument(xml).taxAmountCents).toBe(2300);
  });

  // A party can legally carry more than one PartyTaxScheme — same auto-array gotcha, which
  // previously made icDph come back null even though the (first) VAT scheme was present.
  it("uses the first PartyTaxScheme's CompanyID as icDph when a party has more than one", () => {
    const xml = invoiceXml({
      taxTotals: `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">23.00</cbc:TaxAmount></cac:TaxTotal>`,
      supplierExtraSchemes: [
        `<cac:PartyTaxScheme><cbc:CompanyID>SK1111111111</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`,
        `<cac:PartyTaxScheme><cbc:CompanyID>SK9999999999</cbc:CompanyID><cac:TaxScheme><cbc:ID>XXX</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`,
      ],
    });
    const parsed = parseUblDocument(xml);
    expect(parsed.supplier.icDph).toBe("SK1111111111");
  });

  it("finds the root Invoice element even when it's namespace-prefixed (e.g. <ns3:Invoice>)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns3:Invoice xmlns:ns3="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-PREFIXED-1</cbc:ID>
  <cbc:IssueDate>2026-08-20</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>${partyBlock("1111111111", "Dodávateľ s.r.o.")}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${partyBlock("2222222222", "Odberateľ s.r.o.")}</cac:AccountingCustomerParty>
</ns3:Invoice>`;
    const parsed = parseUblDocument(xml);
    expect(parsed.documentType).toBe("INVOICE");
    expect(parsed.number).toBe("2026-PREFIXED-1");
    expect(parsed.supplier.dic).toBe("1111111111");
  });
});
