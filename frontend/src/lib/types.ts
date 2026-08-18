export const VAT_RATES = [23, 19, 5, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const UNIT_CODES = [
  { code: "C62", label: "ks" },
  { code: "HUR", label: "hod" },
  { code: "KGM", label: "kg" },
  { code: "MTR", label: "m" },
  { code: "LTR", label: "l" },
  { code: "DAY", label: "deň" },
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
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  xml: string | null;
  sapiProviderDocumentId: string | null;
  lines: InvoiceLineDetail[];
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

export interface SapiSendResult {
  success: boolean;
  mock: boolean;
  providerDocumentId?: string;
  status?: string;
  error?: string;
}
