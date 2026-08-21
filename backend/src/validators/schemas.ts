import { z } from "zod";
import { isValidIbanChecksum } from "../lib/iban";
import { isValidUnitCode } from "../lib/unitCodes";

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

export const icoSchema = z.string().regex(/^\d{8}$/, "IČO musí mať presne 8 číslic");
export const dicSchema = z.string().regex(/^\d{10}$/, "DIČ musí mať presne 10 číslic");
export const icDphSchema = nullableOptionalString(/^SK\d{10}$/, "IČ DPH musí byť v tvare SK + 10 číslic");
const ibanSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^SK\d{22}$/, "IBAN musí byť v tvare SK + 22 číslic")
      .refine(isValidIbanChecksum, "Neplatný IBAN (nesedí kontrolný súčet) — skontroluj preklep")
  );
export const nameSchema = z.string().trim().min(1).max(256);
export const postalCodeSchema = z
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

// WP7: {{invoiceNumber}}/{{amount}}/{{dueDate}}/{{customerName}} — see services/emailTemplate.ts.
// Bounded generously (5000 chars) since it's free text a non-technical user edits in a textarea.
const templateTextSchema = (max: number) => z.string().trim().min(1).max(max);

export const emailSettingsSchema = z.object({
  smtpHost: z.string().trim().min(1).max(256),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().min(1).max(256),
  // Plaintext in the request body (over HTTPS, same as sapiSkCredentialSchema.clientSecret) —
  // encrypted at rest by the controller via lib/crypto.ts, never returned back in a response.
  // An empty string means "keep the existing password unchanged" on an update — the frontend
  // never re-sends a password it was never given back (see getEmailSettings), so re-saving an
  // unrelated field like the email template must not force re-entering it. Enforced as required
  // only for the very first save, in the controller (which knows whether a row already exists) —
  // this schema alone can't know that.
  smtpPassword: z.string(),
  fromEmail: z.string().trim().toLowerCase().email(),
  fromName: templateTextSchema(256),
  subjectTemplate: templateTextSchema(256),
  bodyTemplate: templateTextSchema(5000),
});

export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  firstReminderDays: z.number().int().min(1).max(365),
  reminderCount: z.number().int().min(1).max(10),
  intervalDays: z.number().int().min(1).max(365),
  subjectTemplate: templateTextSchema(256),
  bodyTemplate: templateTextSchema(5000),
});

// An explicit "to" override lets sending work even for an invoice created before this field
// existed, or when the saved customerEmail was wrong — falls back to invoice.customerEmail
// when omitted (see invoiceController.sendInvoiceEmail).
export const sendInvoiceEmailSchema = z.object({
  to: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.string().trim().toLowerCase().email("Neplatný formát emailu").optional()
  ),
});

// `new Date("2026-02-31")` does NOT produce Invalid Date — JS silently rolls it over to
// 2026-03-03, so the old `!isNaN(new Date(v).getTime())` check let non-existent calendar days
// through. Round-tripping through Date.UTC and comparing the components back catches that: an
// out-of-range day/month shifts the resulting date, so the components no longer match.
function isValidCalendarDate(v: string): boolean {
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dátum musí byť vo formáte YYYY-MM-DD")
  .refine(isValidCalendarDate, "Neplatný dátum (neexistujúci kalendárny deň)");

// Tolerance absorbs float noise (e.g. 9.99 not being exactly representable) while still
// rejecting genuine sub-cent input (e.g. 0.125), which would otherwise silently distort line
// totals — see invoiceMath.ts. Shared by invoiceLineSchema and priceListItemSchema.
const twoDecimalPriceSchema = z
  .number()
  .nonnegative()
  .max(10_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Cena môže mať najviac 2 desatinné miesta");

const vatRateSchema = z.union([z.literal(23), z.literal(19), z.literal(5), z.literal(0)]);

const unitCodeSchema = z.string().refine(isValidUnitCode, "Neplatná merná jednotka (UN/ECE Rec 20)");

// Capped at 3 decimal places — enough for real fractional units (0.5 hod, 1.25 kg) while
// rejecting float noise (e.g. 2.0000000000000004 from client-side arithmetic), which would
// otherwise land verbatim in the generated XML's InvoicedQuantity/CreditedQuantity.
const quantitySchema = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Množstvo môže mať najviac 3 desatinné miesta");

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema,
  unitCode: unitCodeSchema.default("C62"),
  unitPrice: twoDecimalPriceSchema,
  taxRatePercent: vatRateSchema,
});

// MVP scope: domestic SK-to-SK Peppol invoicing only (matches the brief and the current
// SK CIUS/mandate research). Both parties need a scheme-0245 Peppol ID (their DIČ).
// Cross-border customers under a different country's identifier scheme aren't supported yet.
const nullableOptionalEmail = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.union([z.null(), z.string().trim().toLowerCase().email("Neplatný formát emailu")])
);

export const customerSchema = z.object({
  name: nameSchema,
  ico: nullableOptionalString(/^\d{8}$/, "IČO musí mať presne 8 číslic"),
  dic: dicSchema,
  icDph: icDphSchema,
  street: z.string().trim().min(1).max(256),
  city: z.string().trim().min(1).max(128),
  postalCode: postalCodeSchema,
  country: z.string().trim().length(2).default("SK"),
  // WP7: not part of the legal Peppol document — see schema.prisma Invoice.customerEmail — used
  // only to know who to send the invoice/reminder emails to.
  email: nullableOptionalEmail,
});

export const invoiceInputSchema = z
  .object({
    customer: customerSchema,
    number: z.string().trim().min(1).max(64),
    issueDate: dateSchema,
    dueDate: dateSchema,
    buyerReference: z.string().trim().min(1).max(128),
    lines: z
      .array(invoiceLineSchema)
      .min(1, "Faktúra musí mať aspoň jednu položku")
      .max(200, "Faktúra môže mať najviac 200 položiek"),
    // WP4: only meaningful for a VAT-registered supplier — see WP4 handoff ("daňový doklad k
    // prijatej platbe" is legally required only for platcovia DPH). Ignored otherwise.
    isAdvanceTaxDocument: z.boolean().optional(),
    prepaidAmountCents: z.number().int().nonnegative().optional(),
    prepaidReference: z.string().trim().max(256).optional(),
  })
  .refine((data) => new Date(data.dueDate).getTime() >= new Date(data.issueDate).getTime(), {
    message: "Dátum splatnosti nemôže byť pred dátumom vystavenia",
    path: ["dueDate"],
  })
  // A 386 ("daňový doklad k prijatej platbe") IS itself the document confirming receipt of an
  // advance — it can't also reference an earlier prepayment via its own prepaidAmountCents,
  // that would be a doklad about a doklad. See invoiceController.generateInvoice for how a 386's
  // own amount is instead marked paid in full at creation.
  .refine((data) => !(data.isAdvanceTaxDocument && data.prepaidAmountCents), {
    message: "Daňový doklad k prijatej platbe (386) nemôže mať vlastný preddavok — je sám osebe dokladom o platbe.",
    path: ["prepaidAmountCents"],
  });

export type InvoiceInput = z.infer<typeof invoiceInputSchema>;
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

// Required fields mirror customerSchema exactly (name/dic/street/city/postalCode required,
// ico/icDph optional) so every saved partner is immediately usable to prefill a fully valid
// invoice customer — no separate "draft contact" concept.
const optionalTrimmedString = (max: number, message?: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.union([z.null(), z.string().trim().max(max, message)])
  );

export const partnerSchema = z.object({
  name: nameSchema,
  ico: nullableOptionalString(/^\d{8}$/, "IČO musí mať presne 8 číslic"),
  dic: dicSchema,
  icDph: icDphSchema,
  street: z.string().trim().min(1).max(256),
  city: z.string().trim().min(1).max(128),
  postalCode: postalCodeSchema,
  countryCode: z.string().trim().length(2).default("SK"),
  peppolScheme: nullableOptionalString(/^\d{4}$/, "Peppol scheme musí mať 4 číslice"),
  peppolId: optionalTrimmedString(64, "Peppol ID môže mať najviac 64 znakov"),
  email: nullableOptionalEmail,
  note: optionalTrimmedString(1000, "Poznámka môže mať najviac 1000 znakov"),
  category: optionalTrimmedString(64, "Kategória môže mať najviac 64 znakov"),
});

export const partnerUpdateSchema = partnerSchema.extend({
  isActive: z.boolean(),
});

export const partnerListQuerySchema = z.object({
  q: z.string().trim().max(256).optional(),
  // Exact match (not a substring search like `q`) — used to check "does a partner with this
  // exact DIČ already exist" (e.g. the invoice form's "save to registry" prompt). `q` can't be
  // reused for this: it only searches name/ico, so a DIČ passed as `q` would almost never match.
  dic: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  // z.coerce.boolean() would treat the string "false" as truthy (non-empty string) — only
  // literal "true"/"1" query values should turn this on.
  includeInactive: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
});

export type PartnerInput = z.infer<typeof partnerSchema>;
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;

export const priceListItemSchema = z.object({
  name: nameSchema,
  description: optionalTrimmedString(1000, "Popis môže mať najviac 1000 znakov"),
  unitCode: unitCodeSchema,
  unitPrice: twoDecimalPriceSchema,
  vatRate: vatRateSchema,
  sku: optionalTrimmedString(64, "SKU môže mať najviac 64 znakov"),
});

export const priceListItemUpdateSchema = priceListItemSchema.extend({
  isActive: z.boolean(),
});

export const priceListItemListQuerySchema = z.object({
  q: z.string().trim().max(256).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  includeInactive: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
});

export type PriceListItemInput = z.infer<typeof priceListItemSchema>;
export type PriceListItemUpdateInput = z.infer<typeof priceListItemUpdateSchema>;

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive("Suma úhrady musí byť kladná"),
});

// Lines optional — omitted means "credit the original invoice in full" (its own lines are
// copied server-side). buyerReference optional — defaults to the original invoice's value.
export const creditNoteInputSchema = z.object({
  number: z.string().trim().min(1).max(64),
  issueDate: dateSchema,
  buyerReference: z.string().trim().min(1).max(128).optional(),
  reason: z.string().trim().max(500).optional(),
  lines: z.array(invoiceLineSchema).min(1, "Dobropis musí mať aspoň jednu položku").max(200).optional(),
});
