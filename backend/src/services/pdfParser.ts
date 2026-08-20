// pdfjs-dist ships ESM-only as of v4 (no more CJS build) — this backend uses CommonJS, so
// the legacy Node build has to be loaded via dynamic import() even though this file itself
// is required as CJS. Node supports importing ESM from CJS this way; a static require() does not.
export interface ExtractedField<T> {
  value: T | null;
  confidence: number; // 0 (not found) – 1 (found next to an unambiguous label)
}

export interface ExtractedInvoiceData {
  invoiceNumber: ExtractedField<string>;
  supplierDic: ExtractedField<string>;
  supplierIco: ExtractedField<string>;
  supplierIcDph: ExtractedField<string>;
  iban: ExtractedField<string>;
  totalAmount: ExtractedField<number>;
  taxRatePercent: ExtractedField<number>;
  issueDate: ExtractedField<string>;
  dueDate: ExtractedField<string>;
  overallConfidence: number;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
    fullText += pageText + "\n";
  }
  return fullText;
}

function firstMatch<T>(
  text: string,
  patterns: { regex: RegExp; confidence: number; map?: (m: RegExpMatchArray) => T }[]
): ExtractedField<T> {
  for (const { regex, confidence, map } of patterns) {
    const match = text.match(regex);
    if (match) {
      const value = (map ? map(match) : (match[1] as unknown as T)) ?? null;
      if (value !== null) return { value, confidence };
    }
  }
  return { value: null, confidence: 0 };
}

function toIsoDate(raw: string): string {
  const [day, month, year] = raw.split(".").map((s) => s.trim());
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseSlovakAmount(raw: string): number {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  return Number.parseFloat(cleaned);
}

/**
 * Best-effort regex extraction — no AI/cloud calls, per the brief. Real invoice layouts
 * vary a lot between issuers, so this is deliberately tuned to be a fast prefill, not a
 * source of truth: every field carries a confidence score and the UI must let the user
 * review/edit before anything is submitted.
 */
export function parseInvoiceText(text: string): ExtractedInvoiceData {
  const normalized = text.replace(/[ \t]+/g, " ");

  const invoiceNumber = firstMatch<string>(normalized, [
    {
      // Bounded "skip" (just an optional č./c./: connector) so a numbered prefix like "FAK-"
      // ends up inside the captured value instead of being eaten by the skip itself.
      regex: /(?:Faktúra|Faktura|Číslo faktúry|Cislo faktury)\s*(?:č[íi]slo\s*)?(?:č\.?|c\.?|:)?\s*([A-Za-z0-9/-]{4,20})/i,
      confidence: 0.7,
    },
  ]);

  // Slovak diacritics (Č/Ú/Ľ...) are often missing in PDF text — older accounting software,
  // scans, or export pipelines frequently drop them — so labels match with or without them.
  const supplierDic = firstMatch<string>(normalized, [
    { regex: /DI[ČC]\s*dod[áa]vate[ľl]a[:\s]*([0-9]{10})/i, confidence: 0.9 },
    { regex: /DI[ČC][:\s]*([0-9]{10})/i, confidence: 0.6 },
  ]);

  const supplierIco = firstMatch<string>(normalized, [
    { regex: /I[ČC]O[:\s]*([0-9]{8})/i, confidence: 0.7 },
  ]);

  const supplierIcDph = firstMatch<string>(normalized, [
    { regex: /I[ČC]\s*DPH[:\s]*(SK[0-9]{10})/i, confidence: 0.8 },
    { regex: /\b(SK[0-9]{10})\b/, confidence: 0.5 },
  ]);

  const iban = firstMatch<string>(normalized, [
    {
      regex: /\b(SK\s?[0-9]{2}(?:\s?[0-9]{4}){4}\s?[0-9]{2}|SK[0-9]{22})\b/i,
      confidence: 0.8,
      map: (m) => m[1].replace(/\s+/g, "").toUpperCase(),
    },
  ]);

  const totalAmount = firstMatch<number>(normalized, [
    {
      regex: /(?:Spolu\s*k\s*[úu]hrade|Suma\s*na\s*[úu]hradu|Celkom\s*s\s*DPH)[:\s]*([0-9][0-9\s.,]*[0-9])\s*(?:€|EUR)?/i,
      confidence: 0.85,
      map: (m) => parseSlovakAmount(m[1]),
    },
    {
      regex: /([0-9][0-9\s.,]*[0-9])\s*(?:€|EUR)/i,
      confidence: 0.4,
      map: (m) => parseSlovakAmount(m[1]),
    },
  ]);

  const taxRatePercent = firstMatch<number>(normalized, [
    { regex: /(?:sadzba\s*DPH|DPH)[^\d]{0,10}(23|19|5|0)\s*%/i, confidence: 0.7, map: (m) => Number(m[1]) },
    { regex: /\b(23|19|5)\s*%/, confidence: 0.4, map: (m) => Number(m[1]) },
  ]);

  const issueDate = firstMatch<string>(normalized, [
    {
      regex: /(?:Dátum\s*vystavenia|Datum\s*vystavenia)[:\s]*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i,
      confidence: 0.85,
      map: (m) => toIsoDate(m[1]),
    },
  ]);

  const dueDate = firstMatch<string>(normalized, [
    {
      regex: /(?:Dátum\s*splatnosti|Datum\s*splatnosti|Splatnosť)[:\s]*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i,
      confidence: 0.85,
      map: (m) => toIsoDate(m[1]),
    },
  ]);

  const fields = [invoiceNumber, supplierDic, supplierIco, supplierIcDph, iban, totalAmount, taxRatePercent, issueDate, dueDate];
  const found = fields.filter((f) => f.value !== null);
  const overallConfidence = found.length === 0 ? 0 : found.reduce((s, f) => s + f.confidence, 0) / fields.length;

  return {
    invoiceNumber,
    supplierDic,
    supplierIco,
    supplierIcDph,
    iban,
    totalAmount,
    taxRatePercent,
    issueDate,
    dueDate,
    overallConfidence: Math.round(overallConfidence * 100) / 100,
  };
}
