import { PDFDocument, AFRelationship, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { centsToEur, formatEurCents } from "./invoiceMath";
import { generatePaymentQr } from "./paymentQr";
import type { PartyDetails } from "./xmlGenerator";
import type { ComputedLine, TaxCategoryBreakdown } from "./invoiceMath";

const ASSETS_DIR = join(__dirname, "..", "..", "assets", "fonts");

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const DOCUMENT_TITLES: Record<string, string> = {
  INVOICE: "FAKTÚRA",
  CREDIT_NOTE: "DOBROPIS",
  ADVANCE_TAX_DOCUMENT: "DAŇOVÝ DOKLAD K PRIJATEJ PLATBE",
};

export interface BrandingImage {
  data: Buffer;
  mimeType: string;
}

export interface PdfInvoiceInput {
  documentType: "INVOICE" | "CREDIT_NOTE" | "ADVANCE_TAX_DOCUMENT";
  number: string;
  issueDate: string;
  dueDate: string | null;
  buyerReference: string | null;
  currency: string;
  supplier: PartyDetails & { iban: string; bic?: string | null };
  customer: PartyDetails;
  lines: ComputedLine[];
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  taxBreakdown: TaxCategoryBreakdown[];
  prepaidAmountCents?: number;
  originalInvoiceNumber?: string;
  // Raw UBL XML to embed as a PDF/A-3-style "Associated File" — the Factur-X/ZUGFeRD idea of
  // one file readable by both humans (this PDF's layout) and machines (the embedded XML). See
  // WP6 handoff for the honest scope of what "PDF/A-3" means here (not ISO-validated).
  xmlContent: string;
  branding?: {
    logo?: BrandingImage;
    stamp?: BrandingImage;
    signature?: BrandingImage;
  };
}

const eur = formatEurCents;

export function formatDateSk(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
const formatDate = formatDateSk;

function partyLines(party: PartyDetails): string[] {
  const lines = [party.name, party.street, `${party.postalCode} ${party.city}`, party.country];
  if (party.ico) lines.push(`IČO: ${party.ico}`);
  lines.push(`DIČ: ${party.dic}`);
  if (party.icDph) lines.push(`IČ DPH: ${party.icDph}`);
  return lines;
}

class Layout {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;

  constructor(doc: PDFDocument, page: PDFPage, font: PDFFont, fontBold: PDFFont) {
    this.doc = doc;
    this.page = page;
    this.font = font;
    this.fontBold = fontBold;
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  text(str: string, x: number, size = 10, opts: { bold?: boolean; color?: [number, number, number] } = {}) {
    this.page.drawText(str, {
      x,
      y: this.y,
      size,
      font: opts.bold ? this.fontBold : this.font,
      color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
    });
  }

  line(x1: number, x2: number, color: [number, number, number] = [0.8, 0.8, 0.8]) {
    this.page.drawLine({ start: { x: x1, y: this.y }, end: { x: x2, y: this.y }, thickness: 0.75, color: rgb(...color) });
  }
}

async function loadFonts(doc: PDFDocument): Promise<{ font: PDFFont; fontBold: PDFFont }> {
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(join(ASSETS_DIR, "DejaVuSans.ttf")),
    readFile(join(ASSETS_DIR, "DejaVuSans-Bold.ttf")),
  ]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const fontBold = await doc.embedFont(boldBytes, { subset: true });
  return { font, fontBold };
}

function embedImage(doc: PDFDocument, image: BrandingImage) {
  if (image.mimeType === "image/png") return doc.embedPng(image.data);
  return doc.embedJpg(image.data);
}

export async function generateInvoicePdf(input: PdfInvoiceInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const { font, fontBold } = await loadFonts(doc);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const l = new Layout(doc, page, font, fontBold);

  // --- Header: logo + title ---
  if (input.branding?.logo) {
    try {
      const img = await embedImage(doc, input.branding.logo);
      const maxW = 140;
      const scale = Math.min(1, maxW / img.width);
      l.page.drawImage(img, { x: MARGIN, y: l.y - img.height * scale, width: img.width * scale, height: img.height * scale });
    } catch {
      // A corrupt/unsupported logo must never break invoice generation — just skip it.
    }
  }
  l.text(DOCUMENT_TITLES[input.documentType] ?? "FAKTÚRA", MARGIN + 160, 20, { bold: true });
  l.y -= 26;
  l.text(`č. ${input.number}`, MARGIN + 160, 13, { bold: true });
  l.y -= 40;

  // --- Supplier / customer two-column block ---
  const colGap = 20;
  const colWidth = (CONTENT_WIDTH - colGap) / 2;
  const blockStartY = l.y;
  l.text("Dodávateľ", MARGIN, 9, { bold: true, color: [0.4, 0.4, 0.4] });
  l.text("Odberateľ", MARGIN + colWidth + colGap, 9, { bold: true, color: [0.4, 0.4, 0.4] });
  l.y -= 14;
  const supplierLines = partyLines(input.supplier);
  const customerLines = partyLines(input.customer);
  const rowCount = Math.max(supplierLines.length, customerLines.length);
  for (let i = 0; i < rowCount; i++) {
    if (supplierLines[i]) l.text(supplierLines[i], MARGIN, 10, { bold: i === 0 });
    if (customerLines[i]) l.text(customerLines[i], MARGIN + colWidth + colGap, 10, { bold: i === 0 });
    l.y -= 13;
  }
  l.y = blockStartY - rowCount * 13 - 14 - 20;

  // --- Dates row ---
  l.text(`Dátum vystavenia: ${formatDate(input.issueDate)}`, MARGIN, 10);
  if (input.dueDate) l.text(`Dátum splatnosti: ${formatDate(input.dueDate)}`, MARGIN + 200, 10);
  if (input.buyerReference) l.text(`Referencia: ${input.buyerReference}`, MARGIN + 380, 10);
  l.y -= 16;
  if (input.originalInvoiceNumber) {
    l.text(`Dobropis k faktúre č. ${input.originalInvoiceNumber}`, MARGIN, 10, { bold: true });
    l.y -= 16;
  }
  l.y -= 10;

  // --- Line items table ---
  const cols = { desc: MARGIN, qty: MARGIN + 260, unit: MARGIN + 310, price: MARGIN + 350, vat: MARGIN + 420, total: MARGIN + 460 };
  function tableHeader() {
    l.text("Popis", cols.desc, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.text("Množ.", cols.qty, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.text("MJ", cols.unit, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.text("Cena/MJ", cols.price, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.text("DPH", cols.vat, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.text("Spolu", cols.total, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    l.y -= 6;
    l.line(MARGIN, MARGIN + CONTENT_WIDTH);
    l.y -= 14;
  }
  tableHeader();
  for (const line of input.lines) {
    l.ensureSpace(30);
    if (l.y === PAGE_HEIGHT - MARGIN) tableHeader(); // continued on a fresh page
    const desc = line.description.length > 42 ? line.description.slice(0, 41) + "…" : line.description;
    l.text(desc, cols.desc, 9);
    l.text(String(line.quantity), cols.qty, 9);
    l.text(line.unitCode, cols.unit, 9);
    l.text(eur(line.unitPriceCents), cols.price, 9);
    l.text(`${line.taxRatePercent}%`, cols.vat, 9);
    l.text(eur(line.lineNetCents), cols.total, 9);
    l.y -= 16;
  }
  l.y -= 6;
  l.line(MARGIN, MARGIN + CONTENT_WIDTH);
  l.y -= 20;

  // --- Totals + VAT recap ---
  l.ensureSpace(24 + input.taxBreakdown.length * 14 + 60);
  const totalsX = MARGIN + 320;
  for (const bracket of input.taxBreakdown) {
    l.text(`Základ ${bracket.taxRatePercent}%`, totalsX, 9, { color: [0.35, 0.35, 0.35] });
    l.text(eur(bracket.taxableAmountCents), totalsX + 120, 9, { color: [0.35, 0.35, 0.35] });
    l.text(`DPH ${bracket.taxRatePercent}%`, totalsX + 200, 9, { color: [0.35, 0.35, 0.35] });
    l.text(eur(bracket.taxAmountCents), totalsX + 200 + 70, 9, { color: [0.35, 0.35, 0.35] });
    l.y -= 14;
  }
  l.y -= 4;
  l.text("Základ dane spolu", totalsX, 10);
  l.text(eur(input.netAmountCents), totalsX + 120, 10);
  l.y -= 15;
  l.text("DPH spolu", totalsX, 10);
  l.text(eur(input.taxAmountCents), totalsX + 120, 10);
  l.y -= 15;
  l.line(totalsX, MARGIN + CONTENT_WIDTH);
  l.y -= 15;
  const payableCents = input.grossAmountCents - (input.prepaidAmountCents ?? 0);
  l.text("Spolu s DPH", totalsX, 12, { bold: true });
  l.text(eur(input.grossAmountCents), totalsX + 120, 12, { bold: true });
  l.y -= 16;
  if (input.prepaidAmountCents) {
    l.text("Uhradený preddavok", totalsX, 10, { color: [0.35, 0.35, 0.35] });
    l.text(`-${eur(input.prepaidAmountCents)}`, totalsX + 120, 10, { color: [0.35, 0.35, 0.35] });
    l.y -= 15;
    l.text("Na úhradu", totalsX, 12, { bold: true });
    l.text(eur(payableCents), totalsX + 120, 12, { bold: true });
    l.y -= 16;
  }
  l.y -= 20;

  // --- Payment details + QR (invoices/advance docs only — a credit note isn't "payable") ---
  if (input.documentType !== "CREDIT_NOTE" && payableCents > 0) {
    l.ensureSpace(140);
    const qrY = l.y;
    l.text("Platobné údaje", MARGIN, 10, { bold: true });
    l.y -= 16;
    l.text(`IBAN: ${input.supplier.iban}`, MARGIN, 10);
    l.y -= 14;
    if (input.supplier.bic) {
      l.text(`BIC/SWIFT: ${input.supplier.bic}`, MARGIN, 10);
      l.y -= 14;
    }
    const variableSymbol = input.number.replace(/\D/g, "").slice(0, 10) || "0";
    l.text(`Variabilný symbol: ${variableSymbol}`, MARGIN, 10);
    l.y -= 14;
    l.text(`Suma na úhradu: ${eur(payableCents)}`, MARGIN, 10, { bold: true });

    try {
      const qrPng = await generatePaymentQr({
        iban: input.supplier.iban,
        amountEur: centsToEur(payableCents),
        variableSymbol,
        dueDateIso: input.dueDate ?? input.issueDate,
        note: `${DOCUMENT_TITLES[input.documentType]} ${input.number}`,
        beneficiaryName: input.supplier.name,
      });
      const qrImage = await doc.embedPng(qrPng);
      const qrSize = 100;
      l.page.drawImage(qrImage, { x: MARGIN + CONTENT_WIDTH - qrSize, y: qrY - qrSize + 12, width: qrSize, height: qrSize });
      l.page.drawText("PAY by square", { x: MARGIN + CONTENT_WIDTH - qrSize, y: qrY - qrSize - 2, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
    } catch {
      // A QR generation failure (e.g. an IBAN bysquare rejects) must not block the PDF itself
      // — the payment details are still printed as text above.
    }
    l.y = qrY - 140;
  }

  // --- Stamp + signature footer ---
  if (input.branding?.stamp || input.branding?.signature) {
    l.ensureSpace(90);
    l.y -= 20;
    if (input.branding.stamp) {
      try {
        const img = await embedImage(doc, input.branding.stamp);
        const maxW = 100;
        const scale = Math.min(1, maxW / img.width);
        l.page.drawImage(img, { x: MARGIN, y: l.y - img.height * scale, width: img.width * scale, height: img.height * scale });
      } catch {
        /* skip a corrupt stamp image */
      }
    }
    if (input.branding.signature) {
      try {
        const img = await embedImage(doc, input.branding.signature);
        const maxW = 100;
        const scale = Math.min(1, maxW / img.width);
        l.page.drawImage(img, {
          x: MARGIN + CONTENT_WIDTH - img.width * scale,
          y: l.y - img.height * scale,
          width: img.width * scale,
          height: img.height * scale,
        });
      } catch {
        /* skip a corrupt signature image */
      }
    }
  }

  // --- Embed the UBL XML as a PDF/A-3-style associated file (Factur-X/ZUGFeRD hybrid idea) ---
  await doc.attach(Buffer.from(input.xmlContent, "utf8"), `${input.number}.xml`, {
    mimeType: "application/xml",
    description: "UBL Peppol BIS 3.0 XML — strojovo čitateľná verzia tohto dokladu",
    afRelationship: AFRelationship.Alternative,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
