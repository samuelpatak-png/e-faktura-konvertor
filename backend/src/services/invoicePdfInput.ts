import type { CompanyProfile, Invoice, InvoiceLine } from "@prisma/client";
import { taxBreakdownFromLines } from "./invoiceMath";
import type { BrandingImage, PdfInvoiceInput } from "./pdfGenerator";

export function brandingImage(data: string | null, mimeType: string | null): BrandingImage | undefined {
  if (!data || !mimeType) return undefined;
  return { data: Buffer.from(data, "base64"), mimeType };
}

export type InvoiceWithLinesAndOriginal = Invoice & {
  lines: InvoiceLine[];
  original?: { number: string } | null;
};

/**
 * Maps a persisted Invoice row (+ lines, + optional original for credit notes) into the shape
 * generateInvoicePdf() needs. Shared by the PDF download route and the email-sending paths
 * (manual send + reminder scheduler) so there's exactly one place that reconstructs a PDF from
 * a DB row — see invoiceMath.ts's taxBreakdownFromLines for why this doesn't recompute totals.
 */
export function buildPdfInvoiceInput(invoice: InvoiceWithLinesAndOriginal, profile: CompanyProfile | null): PdfInvoiceInput {
  return {
    documentType: invoice.documentType,
    number: invoice.number,
    issueDate: invoice.issueDate,
    // CreditNoteType has no DueDate concept in UBL — the DB column is only ever populated with
    // a non-meaningful placeholder for those rows, so don't print it.
    dueDate: invoice.documentType === "CREDIT_NOTE" ? null : invoice.dueDate,
    buyerReference: invoice.buyerReference,
    currency: invoice.currency,
    supplier: {
      name: invoice.supplierName,
      ico: invoice.supplierIco,
      dic: invoice.supplierDic,
      icDph: invoice.supplierIcDph,
      street: invoice.supplierStreet,
      city: invoice.supplierCity,
      postalCode: invoice.supplierPostalCode,
      country: invoice.supplierCountry,
      iban: invoice.supplierIban,
      bic: invoice.supplierBic,
    },
    customer: {
      name: invoice.customerName,
      ico: invoice.customerIco,
      dic: invoice.customerDic,
      icDph: invoice.customerIcDph,
      street: invoice.customerStreet,
      city: invoice.customerCity,
      postalCode: invoice.customerPostalCode,
      country: invoice.customerCountry,
    },
    lines: invoice.lines,
    netAmountCents: invoice.netAmountCents,
    taxAmountCents: invoice.taxAmountCents,
    grossAmountCents: invoice.grossAmountCents,
    taxBreakdown: taxBreakdownFromLines(invoice.lines),
    prepaidAmountCents: invoice.prepaidAmountCents ?? undefined,
    originalInvoiceNumber: invoice.original?.number,
    xmlContent: invoice.xml ?? "",
    branding: profile
      ? {
          logo: brandingImage(profile.logoData, profile.logoMimeType),
          stamp: brandingImage(profile.stampData, profile.stampMimeType),
          signature: brandingImage(profile.signatureData, profile.signatureMimeType),
        }
      : undefined,
  };
}
