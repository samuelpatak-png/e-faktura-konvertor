// PaymentStatus is either UNPAID/PARTIALLY_PAID/PAID (derived automatically from paidAmountCents
// vs. the invoice total) or CANCELLED (an explicit action — see invoiceController.cancelInvoice).
// This module never produces CANCELLED itself; callers decide that separately.
export type AutoPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export function computePaymentStatus(paidAmountCents: number, grossAmountCents: number): AutoPaymentStatus {
  if (paidAmountCents <= 0) return "UNPAID";
  if (paidAmountCents < grossAmountCents) return "PARTIALLY_PAID";
  return "PAID";
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A PAID or CANCELLED invoice is never "overdue" regardless of dueDate — this is the whole
 * reason overdue isn't a stored column: it depends on both dueDate and the current
 * paymentStatus, and the latter changes without dueDate changing.
 */
export function isOverdue(dueDate: string, paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED", today: Date = new Date()): boolean {
  if (paymentStatus === "PAID" || paymentStatus === "CANCELLED") return false;
  return dueDate < toIsoDate(today);
}

/** 0 when not (yet) overdue — including when dueDate is exactly today. */
export function daysOverdue(dueDate: string, today: Date = new Date()): number {
  const todayIso = toIsoDate(today);
  if (dueDate >= todayIso) return 0;
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  return Math.round((todayMs - dueMs) / 86_400_000);
}

export type AgingBucket = "notYetDue" | "days0to30" | "days31to60" | "days60plus";

export function agingBucket(days: number): AgingBucket {
  if (days === 0) return "notYetDue";
  if (days <= 30) return "days0to30";
  if (days <= 60) return "days31to60";
  return "days60plus";
}
