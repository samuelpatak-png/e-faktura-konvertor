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

export interface SapiSendResult {
  success: boolean;
  mock: boolean;
  providerDocumentId?: string;
  status?: string;
  error?: string;
}
