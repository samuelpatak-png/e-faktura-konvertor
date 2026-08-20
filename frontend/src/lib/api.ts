import axios from "axios";
import type {
  BrandingAsset,
  CompanyBrandingStatus,
  CompanyProfileInput,
  CompanyProfileWithBranding,
  CompanyRegistryLookupResult,
  CreditNoteInput,
  EmailSettingsInput,
  EmailSettingsStatus,
  ExtractedInvoiceData,
  GenerateResult,
  InvoiceDetail,
  InvoiceInput,
  InvoiceListItem,
  Partner,
  PartnerInput,
  PartnerListResult,
  PartnerUpdateInput,
  PriceListItem,
  PriceListItemInput,
  PriceListItemUpdateInput,
  PriceListResult,
  ReceivedInvoice,
  ReminderSettings,
  SapiSendResult,
  SapiSkStatus,
  SentEmail,
  UnpaidSummary,
  User,
  ValidationResult,
} from "./types";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

/** Extracts a human-readable message from any API error shape this backend returns. */
export function apiErrorMessage(err: unknown, fallback = "Nastala chyba, skús to znova."): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data?.errors?.length) return (data.errors as string[]).join(" ");
    if (data?.validation?.errors?.length) return (data.validation.errors as string[]).join(" ");
    if (data?.details) {
      const messages = Object.values(data.details as Record<string, string[]>).flat();
      if (messages.length) return messages.join(" ");
    }
    if (data?.error) return data.error as string;
  }
  return fallback;
}

/** Pulls the structured ValidationResult out of a 422 "invoice invalid" error response, if present. */
export function apiValidationErrors(err: unknown): ValidationResult | undefined {
  if (axios.isAxiosError(err) && err.response?.data?.validation) {
    return err.response.data.validation as ValidationResult;
  }
  return undefined;
}

export const authApi = {
  me: () => api.get<User>("/auth/me").then((r) => r.data),
  register: (email: string, password: string) => api.post<User>("/auth/register", { email, password }).then((r) => r.data),
  login: (email: string, password: string) => api.post<User>("/auth/login", { email, password }).then((r) => r.data),
  logout: () => api.post("/auth/logout"),
};

export const companyApi = {
  getProfile: () => api.get<CompanyProfileWithBranding | null>("/company/profile").then((r) => r.data),
  saveProfile: (data: CompanyProfileInput) => api.put<CompanyProfileInput>("/company/profile", data).then((r) => r.data),
  getSapiStatus: () => api.get<SapiSkStatus>("/company/sapi-credentials").then((r) => r.data),
  saveSapiCredentials: (clientId: string, clientSecret: string) =>
    api.put<SapiSkStatus>("/company/sapi-credentials", { clientId, clientSecret }).then((r) => r.data),
  setSapiMode: (mode: "mock" | "live") =>
    api.patch<SapiSkStatus>("/company/sapi-credentials/mode", { mode }).then((r) => r.data),
  deleteSapiCredentials: () => api.delete("/company/sapi-credentials"),
  brandingAssetUrl: (asset: BrandingAsset) => `/api/company/branding/${asset}`,
  uploadBranding: (asset: BrandingAsset, file: File) => {
    const formData = new FormData();
    formData.append(asset, file);
    return api.put<CompanyBrandingStatus>("/company/branding", formData).then((r) => r.data);
  },
  removeBrandingAsset: (asset: BrandingAsset) =>
    api.delete<CompanyBrandingStatus>(`/company/branding/${asset}`).then((r) => r.data),
  getEmailSettings: () => api.get<EmailSettingsStatus>("/company/email-settings").then((r) => r.data),
  saveEmailSettings: (data: EmailSettingsInput) =>
    api.put<EmailSettingsStatus>("/company/email-settings", data).then((r) => r.data),
  deleteEmailSettings: () => api.delete("/company/email-settings"),
  getReminderSettings: () => api.get<ReminderSettings | null>("/company/reminder-settings").then((r) => r.data),
  saveReminderSettings: (data: ReminderSettings) =>
    api.put<ReminderSettings>("/company/reminder-settings", data).then((r) => r.data),
};

export const invoiceApi = {
  validate: (data: InvoiceInput) => api.post<ValidationResult>("/invoice/validate", data).then((r) => r.data),
  generate: (data: InvoiceInput) => api.post<GenerateResult>("/invoice/generate", data).then((r) => r.data),
  list: () => api.get<InvoiceListItem[]>("/invoice").then((r) => r.data),
  get: (id: string) => api.get<InvoiceDetail>(`/invoice/${id}`).then((r) => r.data),
  downloadUrl: (id: string) => `/api/invoice/${id}/download`,
  pdfUrl: (id: string) => `/api/invoice/${id}/pdf`,
  sendSapi: (id: string) => api.post<SapiSendResult>(`/invoice/${id}/send-sapi`).then((r) => r.data),
  recordPayment: (id: string, amountCents: number) => api.post<InvoiceDetail>(`/invoice/${id}/payments`, { amountCents }).then((r) => r.data),
  cancel: (id: string) => api.post<InvoiceDetail>(`/invoice/${id}/cancel`).then((r) => r.data),
  unpaidSummary: () => api.get<UnpaidSummary>("/invoice/unpaid-summary").then((r) => r.data),
  createCreditNote: (id: string, data: CreditNoteInput) => api.post<GenerateResult>(`/invoice/${id}/credit-note`, data).then((r) => r.data),
  sendEmail: (id: string, to?: string) =>
    api.post<{ success: boolean; errors?: string[] }>(`/invoice/${id}/send-email`, to ? { to } : {}).then((r) => r.data),
  sendReminderNow: (id: string) =>
    api.post<{ success: boolean; errors?: string[] }>(`/invoice/${id}/send-reminder`).then((r) => r.data),
  listSentEmails: (id: string) => api.get<SentEmail[]>(`/invoice/${id}/emails`).then((r) => r.data),
};

export const partnerApi = {
  list: (params: { q?: string; dic?: string; page?: number; pageSize?: number; includeInactive?: boolean } = {}) =>
    api.get<PartnerListResult>("/partner", { params }).then((r) => r.data),
  get: (id: string) => api.get<Partner>(`/partner/${id}`).then((r) => r.data),
  create: (data: PartnerInput) => api.post<Partner>("/partner", data).then((r) => r.data),
  update: (id: string, data: PartnerUpdateInput) => api.put<Partner>(`/partner/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/partner/${id}`),
  lookupByIco: (ico: string) => api.get<CompanyRegistryLookupResult>(`/partner/registry/${ico}`).then((r) => r.data),
};

export const priceListApi = {
  list: (params: { q?: string; page?: number; pageSize?: number; includeInactive?: boolean } = {}) =>
    api.get<PriceListResult>("/price-list", { params }).then((r) => r.data),
  get: (id: string) => api.get<PriceListItem>(`/price-list/${id}`).then((r) => r.data),
  create: (data: PriceListItemInput) => api.post<PriceListItem>("/price-list", data).then((r) => r.data),
  update: (id: string, data: PriceListItemUpdateInput) => api.put<PriceListItem>(`/price-list/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/price-list/${id}`),
};

export const receivedInvoiceApi = {
  list: () => api.get<ReceivedInvoice[]>("/received-invoice").then((r) => r.data),
  get: (id: string) => api.get<ReceivedInvoice>(`/received-invoice/${id}`).then((r) => r.data),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<ReceivedInvoice>("/received-invoice/upload", formData).then((r) => r.data);
  },
  downloadUrl: (id: string) => `/api/received-invoice/${id}/download`,
  recordPayment: (id: string, amountCents: number) =>
    api.post<ReceivedInvoice>(`/received-invoice/${id}/payments`, { amountCents }).then((r) => r.data),
  remove: (id: string) => api.delete(`/received-invoice/${id}`),
};

export const pdfApi = {
  parse: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api
      .post<{ success: boolean; extracted: ExtractedInvoiceData }>("/pdf/parse", formData)
      .then((r) => r.data);
  },
};
