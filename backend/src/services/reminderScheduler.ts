import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/crypto";
import { daysOverdue } from "./paymentStatus";
import { sendEmail } from "./emailSender";
import { renderTemplate } from "./emailTemplate";
import { formatEurCents } from "./invoiceMath";
import { generateInvoicePdf, formatDateSk } from "./pdfGenerator";
import { buildPdfInvoiceInput } from "./invoicePdfInput";
import type { EmailSettings, Invoice, InvoiceLine, ReminderSettings } from "@prisma/client";

// Safety net against a runaway burst (e.g. a huge backlog after the scheduler was paused for a
// long time) — not a per-invoice/per-company limit, a simple cap on total sends in one tick.
const MAX_REMINDERS_PER_TICK = 50;
const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly — reminder cadences are in days, not minutes

/**
 * Which of settings.reminderCount reminder numbers (1-based) are due given how many days past
 * the due date the invoice is, excluding any already recorded as sent. Reminder N falls on day
 * `firstReminderDays + (N-1) * intervalDays` — a direct reading of the spec's "koľko dní po
 * splatnosti, počet upomienok, odstupy" (days after due date, reminder count, spacing).
 *
 * If several thresholds were missed at once (e.g. the scheduler was down for a while), this
 * returns all of them — sendDueReminders below still send each as its own dated reminder
 * rather than silently skipping ones that were missed, which is the more honest behavior
 * ("did the customer actually get reminded N times") even though it's a rarer path.
 */
export function dueReminderNumbers(
  settings: Pick<ReminderSettings, "firstReminderDays" | "reminderCount" | "intervalDays">,
  daysPastDue: number,
  alreadySent: ReadonlySet<number>
): number[] {
  const due: number[] = [];
  for (let n = 1; n <= settings.reminderCount; n++) {
    const dayForN = settings.firstReminderDays + (n - 1) * settings.intervalDays;
    if (daysPastDue >= dayForN && !alreadySent.has(n)) due.push(n);
  }
  return due;
}

interface ReminderWorkItem {
  invoice: Invoice & { lines: InvoiceLine[] };
  reminderSettings: ReminderSettings;
  emailSettings: EmailSettings;
  reminderNumber: number;
}

async function collectDueReminders(now: Date): Promise<ReminderWorkItem[]> {
  const items: ReminderWorkItem[] = [];

  const allReminderSettings = await prisma.reminderSettings.findMany({
    where: { enabled: true },
    include: { user: { include: { emailSettings: true } } },
  });

  for (const reminderSettings of allReminderSettings) {
    const emailSettings = reminderSettings.user.emailSettings;
    if (!emailSettings) continue; // can't send without SMTP configured — nothing to do here

    // Never a CREDIT_NOTE/ADVANCE_TAX_DOCUMENT (no meaningful "overdue" for those — see
    // paymentStatus.ts callers elsewhere) and never PAID/CANCELLED — this filter is the primary
    // guard against the "most embarrassing possible mistake" the spec calls out; see
    // reminderScheduler.test.ts for the explicit regression test.
    const invoices = await prisma.invoice.findMany({
      where: {
        userId: reminderSettings.userId,
        documentType: "INVOICE",
        paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });

    for (const invoice of invoices) {
      const daysPastDue = daysOverdue(invoice.dueDate, now);
      if (daysPastDue <= 0) continue;

      const sentRows = await prisma.sentEmail.findMany({
        where: { invoiceId: invoice.id, type: "REMINDER", status: "SENT" },
        select: { reminderNumber: true },
      });
      const alreadySent = new Set(sentRows.map((r) => r.reminderNumber).filter((n): n is number => n != null));

      for (const reminderNumber of dueReminderNumbers(reminderSettings, daysPastDue, alreadySent)) {
        items.push({ invoice, reminderSettings, emailSettings, reminderNumber });
      }
    }
  }

  return items;
}

/** Builds and sends one reminder email, logging the outcome (SENT or FAILED) either way. Also
 * used directly by the "Poslať upomienku teraz" manual-send controller action — the paid/
 * cancelled guard below applies there too, not just to the scheduler's own query filter in
 * collectDueReminders, on purpose: this is the single lowest-level place a reminder can be
 * sent from, so it's the right place for the guard the spec calls "the most embarrassing
 * possible mistake toward a customer" to live, rather than trusting every caller to re-check it. */
export async function sendReminderForInvoice(
  invoice: Invoice & { lines: InvoiceLine[] },
  emailSettings: EmailSettings,
  reminderNumber: number,
  bodyTemplate: string,
  subjectTemplate: string
): Promise<{ success: boolean; error?: string }> {
  if (invoice.paymentStatus === "PAID" || invoice.paymentStatus === "CANCELLED") {
    await prisma.sentEmail.create({
      data: {
        userId: invoice.userId,
        invoiceId: invoice.id,
        type: "REMINDER",
        reminderNumber,
        toEmail: invoice.customerEmail ?? "",
        subject: renderTemplate(subjectTemplate, templateVars(invoice, reminderNumber)),
        status: "FAILED",
        errorMessage: `Faktúra je ${invoice.paymentStatus === "PAID" ? "uhradená" : "stornovaná"} — upomienka sa neposlala`,
      },
    });
    return { success: false, error: "Faktúra je uhradená alebo stornovaná — upomienka sa neposlala" };
  }

  if (!invoice.customerEmail) {
    await prisma.sentEmail.create({
      data: {
        userId: invoice.userId,
        invoiceId: invoice.id,
        type: "REMINDER",
        reminderNumber,
        toEmail: "",
        subject: renderTemplate(subjectTemplate, templateVars(invoice, reminderNumber)),
        status: "FAILED",
        errorMessage: "Faktúra nemá email odberateľa",
      },
    });
    return { success: false, error: "Faktúra nemá email odberateľa" };
  }

  const vars = templateVars(invoice, reminderNumber);
  const subject = renderTemplate(subjectTemplate, vars);
  const body = renderTemplate(bodyTemplate, vars);

  const profile = await prisma.companyProfile.findUnique({ where: { userId: invoice.userId } });
  const pdf = await generateInvoicePdf(buildPdfInvoiceInput(invoice, profile));

  const result = await sendEmail({
    smtp: {
      host: emailSettings.smtpHost,
      port: emailSettings.smtpPort,
      secure: emailSettings.smtpSecure,
      user: emailSettings.smtpUser,
      password: decryptSecret(emailSettings.encryptedSmtpPassword),
      fromEmail: emailSettings.fromEmail,
      fromName: emailSettings.fromName,
    },
    to: invoice.customerEmail,
    subject,
    text: body,
    attachments: [
      { filename: `faktura_${invoice.number}.pdf`, content: pdf, contentType: "application/pdf" },
      ...(invoice.xml ? [{ filename: `faktura_${invoice.number}.xml`, content: Buffer.from(invoice.xml, "utf8"), contentType: "application/xml" }] : []),
    ],
  });

  await prisma.sentEmail.create({
    data: {
      userId: invoice.userId,
      invoiceId: invoice.id,
      type: "REMINDER",
      reminderNumber,
      toEmail: invoice.customerEmail,
      subject,
      status: result.success ? "SENT" : "FAILED",
      errorMessage: result.error,
    },
  });

  return result;
}

function templateVars(invoice: Pick<Invoice, "number" | "grossAmountCents" | "dueDate" | "customerName">, reminderNumber?: number) {
  return {
    invoiceNumber: invoice.number,
    amount: formatEurCents(invoice.grossAmountCents),
    dueDate: formatDateSk(invoice.dueDate),
    customerName: invoice.customerName,
    reminderNumber: reminderNumber !== undefined ? String(reminderNumber) : undefined,
  };
}

export async function runReminderCycle(
  now: Date = new Date(),
  maxPerTick: number = MAX_REMINDERS_PER_TICK
): Promise<{ sent: number; failed: number }> {
  const items = (await collectDueReminders(now)).slice(0, maxPerTick);
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    const result = await sendReminderForInvoice(
      item.invoice,
      item.emailSettings,
      item.reminderNumber,
      item.reminderSettings.bodyTemplate,
      item.reminderSettings.subjectTemplate
    );
    if (result.success) sent++;
    else failed++;
  }
  return { sent, failed };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Only called from server.ts — never imported by app.ts or any test, so tests never get a
 * background timer racing their own DB resets (see test/setup.ts). */
export function startReminderScheduler() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runReminderCycle().catch((err) => console.error("Reminder cycle failed:", err));
  }, TICK_INTERVAL_MS);
}

export function stopReminderScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
