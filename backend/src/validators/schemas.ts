import { z } from "zod";
import { isValidIbanChecksum } from "../lib/iban";

// Slovak VAT rates as of the 2026 reform (zákon o DPH §27): 23% standard, 19% and 5% reduced, 0% zero-rated.
// NOTE: the original brief assumed the pre-2026 20%/10%/0% structure — that changed on 1.1.2026.
export const VAT_RATES = [23, 19, 5, 0] as const;

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Heslo musí mať aspoň 8 znakov"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Normalizes "", null and undefined all to null before validating — the frontend sends any
// of the three for "not set" depending on the form (React state vs. an omitted JSON key), and
// null is what Prisma expects to actually clear a nullable column on update (undefined there
// means "leave unchanged", which would silently keep a stale value).
function nullableOptionalString(regex: RegExp, message: string) {
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.union([z.null(), z.string().regex(regex, message)])
  );
}

const icoSchema = z.string().regex(/^\d{8}$/, "IČO musí mať presne 8 číslic");
const dicSchema = z.string().regex(/^\d{10}$/, "DIČ musí mať presne 10 číslic");
const icDphSchema = nullableOptionalString(/^SK\d{10}$/, "IČ DPH musí byť v tvare SK + 10 číslic");
const ibanSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^SK\d{22}$/, "IBAN musí byť v tvare SK + 22 číslic")
      .refine(isValidIbanChecksum, "Neplatný IBAN (nesedí kontrolný súčet) — skontroluj preklep")
  );
const nameSchema = z.string().trim().min(1).max(256);
const postalCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{5}$/, "PSČ musí mať 5 číslic"));

export const companyProfileSchema = z.object({
  name: nameSchema,
  ico: icoSchema,
  dic: dicSchema,
  icDph: icDphSchema,
  street: z.string().trim().min(1).max(256),
  city: z.string().trim().min(1).max(128),
  postalCode: postalCodeSchema,
  country: z.string().trim().length(2).default("SK"),
  iban: ibanSchema,
  bic: nullableOptionalString(/^.{1,11}$/, "BIC môže mať najviac 11 znakov"),
});

export const sapiSkCredentialSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dátum musí byť vo formáte YYYY-MM-DD")
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Neplatný dátum");

export const UNIT_CODES = ["C62", "HUR", "KGM", "MTR", "LTR", "DAY"] as const;

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitCode: z.enum(UNIT_CODES).default("C62"),
  unitPrice: z.number().nonnegative().max(10_000_000),
  taxRatePercent: z.union([z.literal(23), z.literal(19), z.literal(5), z.literal(0)]),
});

// MVP scope: domestic SK-to-SK Peppol invoicing only (matches the brief and the current
// SK CIUS/mandate research). Both parties need a scheme-0245 Peppol ID (their DIČ).
// Cross-border customers under a different country's identifier scheme aren't supported yet.
export const customerSchema = z.object({
  name: nameSchema,
  ico: nullableOptionalString(/^\d{8}$/, "IČO musí mať presne 8 číslic"),
  dic: dicSchema,
  icDph: icDphSchema,
  street: z.string().trim().min(1).max(256),
  city: z.string().trim().min(1).max(128),
  postalCode: postalCodeSchema,
  country: z.string().trim().length(2).default("SK"),
});

export const invoiceInputSchema = z
  .object({
    customer: customerSchema,
    number: z.string().trim().min(1).max(64),
    issueDate: dateSchema,
    dueDate: dateSchema,
    buyerReference: z.string().trim().min(1).max(128),
    lines: z.array(invoiceLineSchema).min(1, "Faktúra musí mať aspoň jednu položku"),
  })
  .refine((data) => new Date(data.dueDate).getTime() >= new Date(data.issueDate).getTime(), {
    message: "Dátum splatnosti nemôže byť pred dátumom vystavenia",
    path: ["dueDate"],
  });

export type InvoiceInput = z.infer<typeof invoiceInputSchema>;
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
