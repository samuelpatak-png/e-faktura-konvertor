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
});
