import type { ComputedLine, TaxCategoryBreakdown } from "./invoiceMath";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidatableInvoice {
  supplierDic: string;
  customerDic: string;
  buyerReference: string;
  lines: ComputedLine[];
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  taxBreakdown: TaxCategoryBreakdown[];
}

/**
 * Business-rule validation mirroring the Peppol/EN16931 rules that matter most for a
 * domestic SK invoice (BR-CO-10/14/15/17, PEPPOL-EN16931-R003), plus the brief's own
 * "logická validácia" checks. Note this is NOT a substitute for formal XSD/Schematron
 * validation against the official Peppol artefacts — see README for why, and run a
 * batch of generated invoices through the official Peppol/EN16931 validator before
 * relying on this for real submissions.
 */
export function validateComputedInvoice(input: ValidatableInvoice): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.supplierDic === input.customerDic) {
    errors.push("Dodávateľ a odberateľ nemôžu mať rovnaké DIČ");
  }
  if (!input.buyerReference.trim()) {
    errors.push("Chýba referencia objednávateľa (BuyerReference je v Peppol BIS 3.0 povinná — pravidlo PEPPOL-EN16931-R003)");
  }
  if (input.lines.length === 0) {
    errors.push("Faktúra musí mať aspoň jednu položku");
  }

  for (const line of input.lines) {
    if (!line.description.trim()) errors.push("Položka bez popisu nie je povolená");
    if (line.lineNetCents < 0) errors.push(`Položka "${line.description}" má zápornú sumu`);
  }

  // These reconcile by construction (invoiceMath.ts is the single source of truth for all
  // amounts), so a failure here would indicate a bug upstream rather than bad user input —
  // kept as an explicit safety net rather than silently trusting the arithmetic.
  const sumLines = input.lines.reduce((sum, l) => sum + l.lineNetCents, 0);
  if (sumLines !== input.netAmountCents) {
    errors.push("Súčet položiek nezodpovedá celkovej sume bez DPH (BR-CO-10)");
  }
  const sumCategoryTax = input.taxBreakdown.reduce((sum, b) => sum + b.taxAmountCents, 0);
  if (sumCategoryTax !== input.taxAmountCents) {
    errors.push("Súčet DPH podľa sadzieb nezodpovedá celkovej DPH (BR-CO-14)");
  }
  if (input.netAmountCents + input.taxAmountCents !== input.grossAmountCents) {
    errors.push("Súčet (bez DPH + DPH) nezodpovedá sume s DPH (BR-CO-15)");
  }
  for (const bracket of input.taxBreakdown) {
    const expected = Math.round((bracket.taxableAmountCents * bracket.taxRatePercent) / 100);
    if (Math.abs(expected - bracket.taxAmountCents) > 1) {
      errors.push(`DPH pri sadzbe ${bracket.taxRatePercent}% nezodpovedá základu dane (BR-CO-17)`);
    }
  }

  if (input.grossAmountCents > 100_000_000) {
    warnings.push("Nezvyčajne vysoká suma faktúry (nad 1 000 000 €) — skontroluj, či nejde o preklep");
  }

  return { valid: errors.length === 0, errors, warnings };
}
