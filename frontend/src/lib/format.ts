const currencyFormatter = new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("sk-SK", { day: "numeric", month: "numeric", year: "numeric" });

export function formatEur(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  return dateFormatter.format(new Date(isoDate));
}

export function centsToEur(cents: number): number {
  return cents / 100;
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Koncept",
  GENERATED: "Vygenerovaná",
  SENT: "Odoslaná",
  SEND_FAILED: "Odoslanie zlyhalo",
};

export function invoiceStatusTone(status: string): "neutral" | "success" | "danger" | "brand" {
  if (status === "SENT") return "success";
  if (status === "SEND_FAILED") return "danger";
  if (status === "GENERATED") return "brand";
  return "neutral";
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Neuhradená",
  PARTIALLY_PAID: "Čiastočne uhradená",
  PAID: "Uhradená",
  CANCELLED: "Stornovaná",
};

// UNPAID on its own isn't alarming (most invoices sit unpaid until their due date) — overdue-ness
// is shown separately (a dedicated "days overdue" indicator), not folded into this badge's color.
export function paymentStatusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "PAID") return "success";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "CANCELLED") return "neutral";
  return "neutral"; // UNPAID
}
