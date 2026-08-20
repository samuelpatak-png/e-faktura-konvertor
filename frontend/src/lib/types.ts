export const VAT_RATES = [23, 19, 5, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

// Kept in sync manually with backend/src/lib/unitCodes.ts (UN/ECE Rec 20, verified against the
// official Peppol code list — see that file's comment before adding more codes here).
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

export interface User {
  id: string;
  email: string;
  companyProfile: CompanyProfile | null;
}

export interface CompanyProfile {
  id: string;
  name: string;
  ico: string;
  dic: string;
  icDph: string | null;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  iban: string;
  bic: string | null;
}

export type CompanyProfileInput = Omit<CompanyProfile, "id">;

export type BrandingAsset = "logo" | "stamp" | "signature";

export interface CompanyBrandingStatus {
  logo: boolean;
  stamp: boolean;
  signature: boolean;
}

export type CompanyProfileWithBranding = CompanyProfileInput & CompanyBrandingStatus;

export interface SapiSkStatus {
  configured: boolean;
  mode: "mock" | "live";
  clientId?: string;
}

export interface CustomerInput {
  name: string;
  ico?: string;
  dic: string;
  icDph?: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  // WP7 — who to email the invoice/reminders to; not part of the legal UBL document.
  email?: string | null;
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitCode: UnitCode;
  unitPrice: number;
  taxRatePercent: VatRate;
}

export interface InvoiceInput {
  customer: CustomerInput;
  number: string;
  issueDate: string;
  dueDate: string;
  buyerReference: string;
  lines: InvoiceLineInput[];
  // WP4 — advance/preddavok handling, see xmlGenerator.ts and the WP4 handoff.
  isAdvanceTaxDocument?: boolean;
  prepaidAmountCents?: number;
  prepaidReference?: string;
}

export interface CreditNoteInput {
  number: string;
  issueDate: string;
  buyerReference?: string;
  reason?: string;
  lines?: InvoiceLineInput[];
}

export interface TaxBreakdownItem {
  taxRatePercent: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface InvoiceSummary {
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
  taxBreakdown: TaxBreakdownItem[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary?: InvoiceSummary;
  xml?: string;
}

export interface GenerateResult {
  success: boolean;
  invoiceId?: string;
  xml?: string;
  validation?: ValidationResult;
  summary?: InvoiceSummary;
  errors?: string[];
}

export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type DocumentType = "INVOICE" | "CREDIT_NOTE" | "ADVANCE_TAX_DOCUMENT";

export interface InvoiceListItem {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  status: "DRAFT" | "GENERATED" | "SENT" | "SEND_FAILED";
  customerName: string;
  grossAmount: number;
  currency: string;
  sentAt: string | null;
  createdAt: string;
  paymentStatus: PaymentStatus;
  paidAmountCents: number;
  paidAt: string | null;
  overdue: boolean;
  daysOverdue: number;
  documentType: DocumentType;
  originalInvoiceId: string | null;
}

export interface UnpaidSummaryBucket {
  count: number;
  amountCents: number;
}

export interface UnpaidSummary {
  totalOutstandingCents: number;
  count: number;
  buckets: {
    notYetDue: UnpaidSummaryBucket;
    days0to30: UnpaidSummaryBucket;
    days31to60: UnpaidSummaryBucket;
    days60plus: UnpaidSummaryBucket;
  };
}

export interface InvoiceLineDetail {
  id: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceCents: number;
  taxRatePercent: number;
  lineNetCents: number;
}

export interface InvoiceDetail extends InvoiceListItem {
  buyerReference: string;
  supplierName: string;
  supplierDic: string;
  customerDic: string;
  customerEmail: string | null;
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  xml: string | null;
  sapiProviderDocumentId: string | null;
  lines: InvoiceLineDetail[];
  prepaidAmountCents: number | null;
  prepaidReference: string | null;
  original: { id: string; number: string; issueDate: string } | null;
  corrections: { id: string; number: string; issueDate: string; grossAmountCents: number }[];
}

// WP7: email sending + reminders.
export interface EmailSettingsStatus {
  configured: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  fromEmail?: string;
  fromName?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
}

export interface EmailSettingsInput {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface ReminderSettings {
  enabled: boolean;
  firstReminderDays: number;
  reminderCount: number;
  intervalDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface SentEmail {
  id: string;
  type: "INVOICE" | "REMINDER";
  reminderNumber: number | null;
  toEmail: string;
  subject: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  sentAt: string;
}

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
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

export interface Partner {
  id: string;
  name: string;
  ico: string | null;
  dic: string;
  icDph: string | null;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  peppolScheme: string | null;
  peppolId: string | null;
  email: string | null;
  note: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PartnerInput = Omit<Partner, "id" | "isActive" | "createdAt" | "updatedAt">;
export type PartnerUpdateInput = PartnerInput & { isActive: boolean };

export interface PartnerListResult {
  items: Partner[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyRegistryLookupResult {
  found: boolean;
  data: { name: string; street: string | null; city: string | null; postalCode: string | null } | null;
}

export interface PriceListItem {
  id: string;
  name: string;
  description: string | null;
  unitCode: string;
  unitPriceCents: number;
  unitPrice: number;
  vatRate: VatRate;
  sku: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PriceListItemInput = {
  name: string;
  description: string | null;
  unitCode: string;
  unitPrice: number;
  vatRate: VatRate;
  sku: string | null;
};
export type PriceListItemUpdateInput = PriceListItemInput & { isActive: boolean };

export interface PriceListResult {
  items: PriceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReceivedInvoiceLine {
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceCents: number;
  taxRatePercent: number;
  lineNetCents: number;
}

export interface ReceivedInvoice {
  id: string;
  documentType: DocumentType;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  supplierName: string;
  supplierIco: string | null;
  supplierDic: string | null;
  supplierIcDph: string | null;
  supplierStreet: string | null;
  supplierCity: string | null;
  supplierPostalCode: string | null;
  supplierCountry: string | null;
  customerName: string | null;
  customerDic: string | null;
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  grossAmount: number;
  lines: ReceivedInvoiceLine[];
  paidAmountCents: number;
  paidAt: string | null;
  paymentStatus: PaymentStatus;
  overdue: boolean;
  daysOverdue: number;
  fileName: string | null;
  ourErrors: string[];
  ourWarnings: string[];
  kositAcceptable: boolean | null;
  kositMessages: string[];
  kositAvailable?: boolean;
  createdAt: string;
}

export interface SapiSendResult {
  success: boolean;
  mock: boolean;
  providerDocumentId?: string;
  status?: string;
  error?: string;
}
