// UN/ECE Recommendation 20 unit-of-measure codes, as used in UBL's unitCode attribute
// (InvoicedQuantity, BaseQuantity) and validated by the Peppol BIS Billing 3.0 Schematron.
// An invalid code here fails Peppol validation outright — this list is therefore restricted to
// codes verified against the official Peppol code list (https://docs.peppol.eu/poacc/billing/3.0/codelist/UNECERec20/),
// not recalled from memory. It is a common-use subset, not the full UN/ECE Rec 20 table (which
// runs to hundreds of entries) — extend it (with the same verification) if a real use case needs
// a code that isn't here yet.
export const UNIT_CODES = [
  { code: "C62", label: "ks" },
  { code: "DAY", label: "deň" },
  { code: "HUR", label: "hod" },
  { code: "MIN", label: "minúta" },
  { code: "MON", label: "mesiac" },
  { code: "ANN", label: "rok" },
  { code: "KGM", label: "kg" },
  { code: "GRM", label: "g" },
  { code: "MGM", label: "mg" },
  { code: "TNE", label: "t (tona)" },
  { code: "LBR", label: "libra" },
  { code: "MTR", label: "m" },
  { code: "CMT", label: "cm" },
  { code: "MMT", label: "mm" },
  { code: "KMT", label: "km" },
  { code: "INH", label: "palec" },
  { code: "FOT", label: "stopa" },
  { code: "MTK", label: "m²" },
  { code: "CMK", label: "cm²" },
  { code: "MMK", label: "mm²" },
  { code: "KMK", label: "km²" },
  { code: "MTQ", label: "m³" },
  { code: "LTR", label: "l" },
  { code: "MLT", label: "ml" },
  { code: "CMQ", label: "cm³" },
  { code: "FTQ", label: "ft³" },
  { code: "KWH", label: "kWh" },
  { code: "EA", label: "each" },
  { code: "DZN", label: "tucet" },
  { code: "GRO", label: "gros (12 tuctov)" },
  { code: "DPC", label: "tucet kusov" },
  { code: "DPR", label: "tucet párov" },
  { code: "LS", label: "paušál" },
  { code: "H60", label: "%" },
] as const;

export type UnitCode = (typeof UNIT_CODES)[number]["code"];

const VALID_UNIT_CODES: ReadonlySet<string> = new Set(UNIT_CODES.map((u) => u.code));

export function isValidUnitCode(code: string): boolean {
  return VALID_UNIT_CODES.has(code);
}
