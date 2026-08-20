import axios from "axios";
import type {
  CompanyProfileInput,
  CompanyRegistryLookupResult,
  ExtractedInvoiceData,
  GenerateResult,
  InvoiceDetail,
  InvoiceInput,
  InvoiceListItem,
  Partner,
  PartnerInput,
  PartnerListResult,
  PartnerUpdateInput,
  SapiSendResult,
  SapiSkStatus,
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
  getProfile: () => api.get<CompanyProfileInput | null>("/company/profile").then((r) => r.data),
  saveProfile: (data: CompanyProfileInput) => api.put<CompanyProfileInput>("/company/profile", data).then((r) => r.data),
  getSapiStatus: () => api.get<SapiSkStatus>("/company/sapi-credentials").then((r) => r.data),
  saveSapiCredentials: (clientId: string, clientSecret: string) =>
    api.put<SapiSkStatus>("/company/sapi-credentials", { clientId, clientSecret }).then((r) => r.data),
  setSapiMode: (mode: "mock" | "live") =>
    api.patch<SapiSkStatus>("/company/sapi-credentials/mode", { mode }).then((r) => r.data),
  deleteSapiCredentials: () => api.delete("/company/sapi-credentials"),
};

export const invoiceApi = {
  validate: (data: InvoiceInput) => api.post<ValidationResult>("/invoice/validate", data).then((r) => r.data),
  generate: (data: InvoiceInput) => api.post<GenerateResult>("/invoice/generate", data).then((r) => r.data),
  list: () => api.get<InvoiceListItem[]>("/invoice").then((r) => r.data),
  get: (id: string) => api.get<InvoiceDetail>(`/invoice/${id}`).then((r) => r.data),
  downloadUrl: (id: string) => `/api/invoice/${id}/download`,
  sendSapi: (id: string) => api.post<SapiSendResult>(`/invoice/${id}/send-sapi`).then((r) => r.data),
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

export const pdfApi = {
  parse: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api
      .post<{ success: boolean; extracted: ExtractedInvoiceData }>("/pdf/parse", formData)
      .then((r) => r.data);
  },
};
