import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/crypto";
import { daysOverdue, sumCreditedCents } from "./paymentStatus";
import { sendEmail } from "./emailSender";
import { renderTemplate, buildInvoiceTemplateVars } from "./emailTemplate";
import { generateInvoicePdf } from "./pdfGenerator";
import { buildPdfInvoiceInput } from "./invoicePdfInput";
import type { Invoice, InvoiceLine, ReminderSettings } from "@prisma/client";

// Safety net against a runaway burst (e.g. a huge backlog after the scheduler was paused for a
// long time) — not a per-invoice/per-company limit, a simple cap on total sends in one tick.
const MAX_REMINDERS_PER_TICK = 50;
const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly — reminder cadences are in days, not minutes

// Manual sends (reminderNumber === 0) have no other idempotency guard — collectDueReminders'
// alreadySent check only covers the scheduler's own 1-based numbering — so this cooldown is the
// one thing protecting against a double-click or a scripted loop hitting "Poslať upomienku
// teraz" repeatedly. 5 minutes is generous enough to never block a legitimate second attempt
// after fixing something (e.g. a typo'd customer email) but short enough to stop a spam burst.
const MANUAL_REMINDER_COOLDOWN_MS = 5 * 60 * 1000;

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
  reminderNumber: number;
}

/**
 * Batched on purpose: earlier versions of this function queried invoices per-company and
 * sent-email rows per-invoice (an N+1 — really an M+M×K — pattern that ran every hour). This
 * version does exactly 3 queries total regardless of how many companies/invoices exist:
 * reminder settings, all their invoices in one IN-query, and all relevant sent-email rows in
 * one IN-query, with the grouping done in memory.
 */
async function collectDueReminders(now: Date): Promise<ReminderWorkItem[]> {
  const allReminderSettings = await prisma.reminderSettings.findMany({
    where: { enabled: true },
    include: { user: { include: { emailSettings: true } } },
  });

  // Only companies that both enabled reminders AND have SMTP configured — filtered up front so
  // the batched invoice query below never fetches work for a company that can't send anyway.
  const eligible = allReminderSettings.filter((rs) => rs.user.emailSettings !== null);
  if (eligible.length === 0) return [];

  const settingsByUserId = new Map(eligible.map((rs) => [rs.userId, rs]));

  // Never a CREDIT_NOTE/ADVANCE_TAX_DOCUMENT (no meaningful "overdue" for those — see
  // paymentStatus.ts callers elsewhere) and never PAID/CANCELLED — this filter is the primary
  // guard against the "most embarrassing possible mistake" the spec calls out; see
  // reminderScheduler.test.ts for the explicit regression test.
  const invoices = await prisma.invoice.findMany({
    where: {
      userId: { in: [...settingsByUserId.keys()] },
      documentType: "INVOICE",
      paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  // daysOverdue (paymentStatus.ts) derives "today" from the UTC calendar date. That's an
  // intentional, DST-safe choice for a background job, not a per-user-timezone one — the
  // observable effect is that a reminder threshold can be evaluated up to ~2 hours later than a
  // literal Europe/Bratislava midnight, which only ever delays a reminder within the same
  // hourly tick window, never skips or double-sends one.
  const overdue = invoices
    .map((invoice) => ({ invoice, daysPastDue: daysOverdue(invoice.dueDate, now) }))
    .filter((x) => x.daysPastDue > 0);

  const sentRows = overdue.length
    ? await prisma.sentEmail.findMany({
        where: { invoiceId: { in: overdue.map((x) => x.invoice.id) }, type: "REMINDER", status: "SENT" },
        select: { invoiceId: true, reminderNumber: true },
      })
    : [];

  const alreadySentByInvoice = new Map<string, Set<number>>();
  for (const row of sentRows) {
    if (row.reminderNumber == null) continue;
    const set = alreadySentByInvoice.get(row.invoiceId) ?? new Set<number>();
    set.add(row.reminderNumber);
    alreadySentByInvoice.set(row.invoiceId, set);
  }

  const items: ReminderWorkItem[] = [];
  for (const { invoice, daysPastDue } of overdue) {
    const reminderSettings = settingsByUserId.get(invoice.userId);
    if (!reminderSettings) continue; // invoices were queried by exactly these userIds — defensive only
    const alreadySent = alreadySentByInvoice.get(invoice.id) ?? new Set<number>();
    for (const reminderNumber of dueReminderNumbers(reminderSettings, daysPastDue, alreadySent)) {
      items.push({ invoice, reminderSettings, reminderNumber });
    }
  }

  return items;
}

async function logFailedReminder(
  invoice: Pick<Invoice, "userId" | "id" | "customerEmail">,
  reminderNumber: number,
  subject: string,
  errorMessage: string
) {
  await prisma.sentEmail.create({
    data: {
      userId: invoice.userId,
      invoiceId: invoice.id,
      type: "REMINDER",
      reminderNumber,
      toEmail: invoice.customerEmail ?? "",
      subject,
      status: "FAILED",
      errorMessage,
    },
  });
}

/** Builds and sends one reminder email, logging the outcome (SENT or FAILED) either way. Also
 * used directly by the "Poslať upomienku teraz" manual-send controller action — the paid/
 * cancelled guard below applies there too, not just to the scheduler's own query filter in
 * collectDueReminders, on purpose: this is the single lowest-level place a reminder can be
 * sent from, so it's the right place for the guard the spec calls "the most embarrassing
 * possible mistake toward a customer" to live, rather than trusting every caller to re-check it.
 *
 * Fetches EmailSettings itself (rather than accepting it as a parameter) so a password rotated
 * mid-tick is always picked up fresh — the scheduler can process several invoices for the same
 * company in one run, and a stale captured snapshot would keep using a superseded password for
 * the rest of that batch. */
export async function sendReminderForInvoice(
  invoice: Invoice & { lines: InvoiceLine[] },
  reminderNumber: number,
  bodyTemplate: string,
  subjectTemplate: string
): Promise<{ success: boolean; error?: string }> {
  // Re-read fresh from the DB rather than trusting the passed-in `invoice` — collectDueReminders
  // loads every due invoice once at the start of a tick and this function then sends them one at
  // a time; if an earlier item in the same tick is slow (e.g. a laggy SMTP host), a payment or
  // cancellation recorded via the API mid-tick must still be caught by the guards below, not
  // just at the *next* hourly collectDueReminders query. sendReminderNow (manual send) already
  // fetches fresh right before calling this, but re-fetching here too is one cheap indexed
  // lookup and means the guard never depends on what a given caller happened to do.
  const current = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, corrections: { select: { grossAmountCents: true } } },
  });
  if (!current) {
    // No delete-invoice endpoint exists today, so unreachable in practice — fails loudly rather
    // than sending against stale data if that ever changes.
    return { success: false, error: "Faktúra už neexistuje" };
  }

  const creditedCents = sumCreditedCents(current.corrections);
  const subjectForLog = renderTemplate(subjectTemplate, buildInvoiceTemplateVars(current, reminderNumber, creditedCents));

  if (current.paymentStatus === "PAID" || current.paymentStatus === "CANCELLED") {
    const reason = `Faktúra je ${current.paymentStatus === "PAID" ? "uhradená" : "stornovaná"} — upomienka sa neposlala`;
    await logFailedReminder(current, reminderNumber, subjectForLog, reason);
    return { success: false, error: "Faktúra je uhradená alebo stornovaná — upomienka sa neposlala" };
  }

  if (!current.customerEmail) {
    await logFailedReminder(current, reminderNumber, subjectForLog, "Faktúra nemá email odberateľa");
    return { success: false, error: "Faktúra nemá email odberateľa" };
  }

  if (!current.xml) {
    // Matches the guard downloadInvoicePdf/sendInvoiceEmail already enforce (invoiceController.ts)
    // — unreachable via this app's own code today (every Invoice-creation path sets xml), but a
    // reminder must fail loudly here too rather than silently mail out a PDF with an empty
    // embedded-XML attachment if that ever stops being true.
    await logFailedReminder(current, reminderNumber, subjectForLog, "Faktúra ešte nemá vygenerované XML");
    return { success: false, error: "Faktúra ešte nemá vygenerované XML" };
  }

  if (reminderNumber === 0) {
    const recentManualSend = await prisma.sentEmail.findFirst({
      where: {
        invoiceId: current.id,
        type: "REMINDER",
        reminderNumber: 0,
        status: "SENT",
        sentAt: { gte: new Date(Date.now() - MANUAL_REMINDER_COOLDOWN_MS) },
      },
    });
    if (recentManualSend) {
      const error = "Upomienka bola nedávno odoslaná — počkaj chvíľu pred ďalším odoslaním.";
      await logFailedReminder(current, reminderNumber, subjectForLog, error);
      return { success: false, error };
    }
  }

  const emailSettings = await prisma.emailSettings.findUnique({ where: { userId: current.userId } });
  if (!emailSettings) {
    // collectDueReminders already filters on this for the scheduler path, but sendReminderNow
    // (manual button) calls this function directly without going through collectDueReminders at
    // all, and settings could also have been deleted between collection and send.
    const error = "Najprv nastav SMTP v Nastaveniach.";
    await logFailedReminder(current, reminderNumber, subjectForLog, error);
    return { success: false, error };
  }

  const vars = buildInvoiceTemplateVars(current, reminderNumber, creditedCents);
  const subject = renderTemplate(subjectTemplate, vars);
  const body = renderTemplate(bodyTemplate, vars);

  const profile = await prisma.companyProfile.findUnique({ where: { userId: current.userId } });
  const pdf = await generateInvoicePdf(buildPdfInvoiceInput(current, profile));

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
    to: current.customerEmail,
    subject,
    text: body,
    attachments: [
      { filename: `faktura_${current.number}.pdf`, content: pdf, contentType: "application/pdf" },
      { filename: `faktura_${current.number}.xml`, content: Buffer.from(current.xml, "utf8"), contentType: "application/xml" },
    ],
  });

  await prisma.sentEmail.create({
    data: {
      userId: current.userId,
      invoiceId: current.id,
      type: "REMINDER",
      reminderNumber,
      toEmail: current.customerEmail,
      subject,
      status: result.success ? "SENT" : "FAILED",
      errorMessage: result.error,
    },
  });

  return result;
}

export async function runReminderCycle(
  now: Date = new Date(),
  maxPerTick: number = MAX_REMINDERS_PER_TICK
): Promise<{ sent: number; failed: number }> {
  const items = (await collectDueReminders(now)).slice(0, maxPerTick);
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const result = await sendReminderForInvoice(item.invoice, item.reminderNumber, item.reminderSettings.bodyTemplate, item.reminderSettings.subjectTemplate);
      if (result.success) sent++;
      else failed++;
    } catch (err) {
      // A single poisoned item (e.g. a corrupted encrypted SMTP password that makes
      // decryptSecret throw) must never take down every other company's reminders in the same
      // tick — log it and keep going instead of letting the exception abort the loop.
      console.error(`Reminder send threw for invoice ${item.invoice.id}:`, err);
      failed++;
    }
  }
  return { sent, failed };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let cycleInProgress = false;

/** Only called from server.ts — never imported by app.ts or any test, so tests never get a
 * background timer racing their own DB resets (see test/setup.ts). */
export function startReminderScheduler() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    // If a previous cycle is still running (e.g. a slow/unresponsive SMTP host made a 50-item
    // batch take longer than the tick interval), skip this tick entirely rather than starting a
    // second overlapping cycle — two cycles running at once could both see the same invoice as
    // "not yet sent" and double-send it, since a SentEmail row is only written after each send
    // completes.
    if (cycleInProgress) return;
    cycleInProgress = true;
    runReminderCycle()
      .catch((err) => console.error("Reminder cycle failed:", err))
      .finally(() => {
        cycleInProgress = false;
      });
  }, TICK_INTERVAL_MS);
}

export function stopReminderScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
