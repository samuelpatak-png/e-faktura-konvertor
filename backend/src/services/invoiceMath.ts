import Decimal from "decimal.js";
import type { InvoiceInput } from "../validators/schemas";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export interface ComputedLine {
  sortOrder: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceCents: number;
  taxRatePercent: number;
  lineNetCents: number;
}

export interface TaxCategoryBreakdown {
  taxRatePercent: number;
  taxableAmountCents: number;
  taxAmountCents: number;
}

export interface ComputedInvoiceTotals {
  lines: ComputedLine[];
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  taxBreakdown: TaxCategoryBreakdown[];
}

export function eurToCents(amount: number): number {
  return new Decimal(amount).times(100).toDecimalPlaces(0).toNumber();
}

export function centsToEur(cents: number): number {
  return new Decimal(cents).dividedBy(100).toNumber();
}

/** "123,00 €" — sk-SK formatted, shared by the PDF and the email template renderer so an
 * amount never reads differently between the two. */
export function formatEurCents(cents: number): string {
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(centsToEur(cents));
}

/**
 * Computes all line and invoice-level amounts from scratch off the submitted line items.
 * We never trust client-supplied totals — this is the single source of truth, which
 * also satisfies Peppol/EN16931 rules BR-CO-14/15/17 by construction:
 * VAT category tax = taxable amount (sum of that category's line nets) × rate, computed
 * once per category (not summed from per-line roundings), so category and grand totals
 * always reconcile exactly with no drift.
 */
export function computeInvoiceTotals(input: Pick<InvoiceInput, "lines">): ComputedInvoiceTotals {
  const lines: ComputedLine[] = input.lines.map((line, index) => {
    const unitPriceCents = eurToCents(line.unitPrice);
    // Computed from the raw unitPrice, not the already-rounded unitPriceCents above — rounding
    // the unit price first and then multiplying by quantity would amplify that rounding error
    // by quantity (e.g. a fraction-of-a-cent unit price on a large order).
    const lineNetCents = new Decimal(line.quantity)
      .times(line.unitPrice)
      .times(100)
      .toDecimalPlaces(0)
      .toNumber();
    return {
      sortOrder: index,
      description: line.description,
      quantity: line.quantity,
      unitCode: line.unitCode,
      unitPriceCents,
      taxRatePercent: line.taxRatePercent,
      lineNetCents,
    };
  });

  const taxBreakdown = taxBreakdownFromLines(lines);
  const netAmountCents = lines.reduce((sum, l) => sum + l.lineNetCents, 0);
  const taxAmountCents = taxBreakdown.reduce((sum, b) => sum + b.taxAmountCents, 0);
  const grossAmountCents = netAmountCents + taxAmountCents;

  return { lines, netAmountCents, taxAmountCents, grossAmountCents, taxBreakdown };
}

/**
 * Regroups already-computed lines (e.g. loaded back from InvoiceLine rows in cents) into
 * per-rate VAT categories. Shared with computeInvoiceTotals so both paths reconcile via the
 * same rounding rule (BR-CO-14/15) instead of two independently-written groupings drifting.
 */
export function taxBreakdownFromLines(lines: Pick<ComputedLine, "taxRatePercent" | "lineNetCents">[]): TaxCategoryBreakdown[] {
  const netByRate = new Map<number, number>();
  for (const line of lines) {
    netByRate.set(line.taxRatePercent, (netByRate.get(line.taxRatePercent) ?? 0) + line.lineNetCents);
  }

  return [...netByRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([taxRatePercent, taxableAmountCents]) => ({
      taxRatePercent,
      taxableAmountCents,
      taxAmountCents: new Decimal(taxableAmountCents)
        .times(taxRatePercent)
        .dividedBy(100)
        .toDecimalPlaces(0)
        .toNumber(),
    }));
}
