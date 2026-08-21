import type { Invoice } from "@prisma/client";
import { formatEurCents } from "./invoiceMath";
import { formatDateSk } from "./pdfGenerator";

export interface TemplateVars {
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  customerName: string;
  reminderNumber?: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Plain `{{variable}}` substitution — not a template engine (no conditionals/loops), matching
 * what the spec actually asks for. An unknown placeholder is left as-is rather than throwing,
 * so a typo in a user-edited template degrades to visible text instead of blocking sending.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const dict: Record<string, string | undefined> = { ...vars };
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = dict[key];
    return value !== undefined ? value : match;
  });
}

/**
 * Single source of truth for turning an Invoice row into email template variables — shared by
 * the manual "Odoslať emailom"/"Poslať upomienku teraz" controller actions and the reminder
 * scheduler, so a fix here (or a future variable) never has to be applied twice.
 *
 * `amount` is the outstanding balance (gross minus what's already paid and credited), not the
 * invoice total — a PARTIALLY_PAID invoice is still emailed/reminded (see reminderScheduler.ts),
 * and telling the customer they owe the full original amount after they've already paid part of
 * it (or received a credit note) would be actively wrong, not just imprecise. Floored at 0 so a
 * same-tick race between a payment and a send can never render as a negative amount.
 *
 * `dueDate` is nulled out for CREDIT_NOTE the same way buildPdfInvoiceInput does for the PDF
 * attached to the same email — the DB column holds a non-meaningful placeholder for those rows
 * (UBL CreditNoteType has no DueDate concept), so the email text and the PDF must agree.
 */
export function buildInvoiceTemplateVars(
  invoice: Pick<Invoice, "number" | "documentType" | "dueDate" | "grossAmountCents" | "paidAmountCents" | "customerName">,
  reminderNumber?: number,
  creditedCents = 0
): TemplateVars {
  const outstandingCents = Math.max(0, invoice.grossAmountCents - invoice.paidAmountCents - creditedCents);
  return {
    invoiceNumber: invoice.number,
    amount: formatEurCents(outstandingCents),
    dueDate: formatDateSk(invoice.documentType === "CREDIT_NOTE" ? null : invoice.dueDate),
    customerName: invoice.customerName,
    reminderNumber: reminderNumber !== undefined ? String(reminderNumber) : undefined,
  };
}
