import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { decode } from "bysquare/pay";
import { generateInvoicePdf, type PdfInvoiceInput } from "./pdfGenerator";
import type { ComputedLine, TaxCategoryBreakdown } from "./invoiceMath";

// See paymentQr.test.ts for why: the production `new Function`-based dynamic import that
// bysquarePayLoader.ts needs for the real server runtime doesn't work inside Vitest's
// worker-thread sandbox. Without this mock, generateInvoicePdf's QR step would silently fail
// (it's wrapped in a try/catch so a QR problem never blocks the rest of the PDF — see
// pdfGenerator.ts) and every test below would keep passing with no QR actually embedded, which
// is exactly the failure mode that shipped invisibly before this file caught it.
vi.mock("./bysquarePayLoader", async () => {
  const real = await import("bysquare/pay");
  return { loadBysquarePay: async () => real };
});

// A 1x1 red PNG — enough to exercise the logo/stamp/signature embed path without a real asset.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function extractText(pdfBytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "pdf-test-"));
  const pdfPath = join(dir, "doc.pdf");
  writeFileSync(pdfPath, pdfBytes);
  try {
    return execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasPdftoppm(): boolean {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Rasterizes page 1 at a high enough DPI that a phone-camera-equivalent decoder (jsQR) can
 * read the embedded payment QR back — this is the closest thing to "scan it with a real app"
 * that can run unattended in CI. */
function renderFirstPageToPng(pdfBytes: Buffer): { data: Uint8ClampedArray; width: number; height: number } {
  const dir = mkdtempSync(join(tmpdir(), "pdf-qr-test-"));
  const pdfPath = join(dir, "doc.pdf");
  const prefix = join(dir, "page");
  writeFileSync(pdfPath, pdfBytes);
  try {
    execFileSync("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", "-singlefile", pdfPath, prefix]);
    const png = PNG.sync.read(readFileSync(`${prefix}.png`));
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines: ComputedLine[] = [
  { sortOrder: 0, description: "Konzultačné služby žabíček", quantity: 2, unitCode: "HUR", unitPriceCents: 5000, taxRatePercent: 23, lineNetCents: 10000 },
];
const taxBreakdown: TaxCategoryBreakdown[] = [{ taxRatePercent: 23, taxableAmountCents: 10000, taxAmountCents: 2300 }];

function baseInput(overrides: Partial<PdfInvoiceInput> = {}): PdfInvoiceInput {
  return {
    documentType: "INVOICE",
    number: "2026-0099",
    issueDate: "2026-08-20",
    dueDate: "2026-09-03",
    buyerReference: "OBJ-1",
    currency: "EUR",
    supplier: {
      name: "Žabíček & synovia s.r.o.",
      ico: "11111111",
      dic: "1111111111",
      icDph: "SK1111111111",
      street: "Ľubochnianska 1",
      city: "Ružomberok",
      postalCode: "03401",
      country: "SK",
      iban: "SK3112000000198742637541",
    },
    customer: {
      name: "Odberateľ s.r.o.",
      ico: null,
      dic: "2222222222",
      icDph: null,
      street: "Ulica 2",
      city: "Košice",
      postalCode: "04001",
      country: "SK",
    },
    lines,
    netAmountCents: 10000,
    taxAmountCents: 2300,
    grossAmountCents: 12300,
    taxBreakdown,
    xmlContent: "<Invoice><cbc:ID>2026-0099</cbc:ID></Invoice>",
    ...overrides,
  };
}

describe("generateInvoicePdf", () => {
  it("produces a valid, loadable PDF", async () => {
    const bytes = await generateInvoicePdf(baseInput());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("embeds the XML as a PDF/A-3-style associated file", async () => {
    // pdf-lib bundles most small dictionary objects (including the filename and
    // AFRelationship) into a compressed ObjStm, so only the /EmbeddedFile stream's own
    // dictionary stays inspectable as plaintext here — that's still solid proof the
    // attachment mechanism engaged. The afRelationship value itself is TypeScript-enum-checked
    // at the call site (see pdfGenerator.ts), not re-verified byte-for-byte here.
    const bytes = await generateInvoicePdf(baseInput());
    const raw = bytes.toString("latin1");
    expect(raw).toContain("/Type /EmbeddedFile");
    expect(raw).toContain("/Subtype /application#2Fxml");
  });

  it.skipIf(!hasPdftotext())("renders Slovak diacritics and key invoice data as real extractable text, not garbled glyphs", async () => {
    const bytes = await generateInvoicePdf(baseInput());
    const text = extractText(bytes);
    expect(text).toContain("2026-0099");
    expect(text).toContain("Žabíček");
    expect(text).toContain("Ľubochnianska");
    expect(text).toContain("Konzultačné služby žabíček");
  });

  it.skipIf(!hasPdftoppm())(
    "embeds a real, scannable PAY by square QR code that decodes back to the invoice's payment data",
    async () => {
      const bytes = await generateInvoicePdf(baseInput());
      const { data, width, height } = renderFirstPageToPng(bytes);
      const found = jsQR(data, width, height);
      expect(found).not.toBeNull();
      const payment = decode(found!.data).payments[0];
      expect(payment.amount).toBe(123); // grossAmountCents 12300, no prepayment
      expect(payment.currencyCode).toBe("EUR");
      expect(payment.variableSymbol).toBe("20260099"); // digits of "2026-0099"
      expect(payment.bankAccounts?.[0]?.iban).toBe("SK3112000000198742637541");
    }
  );

  it("does not render a payment QR section for a credit note", async () => {
    const bytes = await generateInvoicePdf(baseInput({ documentType: "CREDIT_NOTE", dueDate: null, originalInvoiceNumber: "2026-0001" }));
    if (!hasPdftotext()) return;
    const text = extractText(bytes);
    expect(text).not.toContain("PAY by square");
    expect(text).toContain("Dobropis k faktúre");
  });

  it("shows the reduced payable amount (not the full gross) when a prepayment is declared", async () => {
    const bytes = await generateInvoicePdf(baseInput({ prepaidAmountCents: 5000 }));
    if (!hasPdftotext()) return;
    const text = extractText(bytes);
    expect(text).toMatch(/Na úhradu/);
    expect(text).toContain("73,00"); // 123.00 - 50.00
  });

  it("embeds logo/stamp/signature images without throwing", async () => {
    const bytes = await generateInvoicePdf(
      baseInput({
        branding: {
          logo: { data: TINY_PNG, mimeType: "image/png" },
          stamp: { data: TINY_PNG, mimeType: "image/png" },
          signature: { data: TINY_PNG, mimeType: "image/png" },
        },
      })
    );
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("does not crash on a corrupt logo image — skips it and still produces a valid PDF", async () => {
    const bytes = await generateInvoicePdf(baseInput({ branding: { logo: { data: Buffer.from("not a png"), mimeType: "image/png" } } }));
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("paginates a large number of line items instead of overflowing a single page", async () => {
    const manyLines: ComputedLine[] = Array.from({ length: 80 }, (_, i) => ({
      sortOrder: i,
      description: `Položka číslo ${i + 1}`,
      quantity: 1,
      unitCode: "C62",
      unitPriceCents: 1000,
      taxRatePercent: 23,
      lineNetCents: 1000,
    }));
    const bytes = await generateInvoicePdf(
      baseInput({ lines: manyLines, netAmountCents: 80000, taxAmountCents: 18400, grossAmountCents: 98400, taxBreakdown: [{ taxRatePercent: 23, taxableAmountCents: 80000, taxAmountCents: 18400 }] })
    );
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);
  });

  it("keeps the file size reasonable (fonts are subsetted, not embedded in full)", async () => {
    const bytes = await generateInvoicePdf(baseInput());
    expect(bytes.length).toBeLessThan(100 * 1024);
  });
});
