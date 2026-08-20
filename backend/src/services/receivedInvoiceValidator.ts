import type { ParsedUblDocument } from "./ublParser";

export interface ReceivedValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Fast, human-readable (Slovak) sanity checks for a document someone else sent us — separate
 * from invoiceValidator.ts, which encodes rules for *our own* outbound invoices (e.g. "supplier
 * must have IČ DPH for a >0% line") that don't apply the same way to a foreign document whose
 * sender's VAT status we can't independently confirm. Each message says what to do about it,
 * not just what's wrong — per the WP5 spec.
 */
export function validateParsedDocument(doc: ParsedUblDocument): ReceivedValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!doc.supplier.dic) {
    errors.push("Faktúre chýba identifikátor dodávateľa (DIČ / Peppol ID) — over dokument u odosielateľa, môže byť neúplný alebo poškodený.");
  }
  if (doc.lines.length === 0) {
    errors.push("Faktúra neobsahuje žiadne položky — over, že sa nahral správny súbor.");
  }
  for (const line of doc.lines) {
    if (line.lineNetCents < 0) {
      warnings.push(`Položka "${line.description}" má zápornú sumu — bežné pri opravných riadkoch, ale over, či je to zámer.`);
    }
  }

  // Tolerance scales with line count to absorb ordinary per-line cent rounding — this is a
  // sanity check on someone else's arithmetic, not a strict BR-CO-10 gate the way our own
  // outbound validator is (we don't control how the sender rounded).
  const sumLines = doc.lines.reduce((s, l) => s + l.lineNetCents, 0);
  if (Math.abs(sumLines - doc.netAmountCents) > Math.max(1, doc.lines.length)) {
    warnings.push("Súčet položiek sa líši od uvedeného základu dane vo faktúre — over sumy pred zaúčtovaním.");
  }
  if (doc.netAmountCents + doc.taxAmountCents !== doc.grossAmountCents) {
    errors.push("Základ dane + DPH nezodpovedá celkovej sume s DPH uvedenej v dokumente — over sumy pred zaúčtovaním, dokument môže byť poškodený.");
  }
  if (doc.grossAmountCents <= 0) {
    warnings.push("Celková suma faktúry je nulová alebo záporná — over, že ide o platný doklad.");
  }

  return { errors, warnings };
}
