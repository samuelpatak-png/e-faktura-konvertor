import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/crypto";
import { dueReminderNumbers, runReminderCycle, sendReminderForInvoice } from "./reminderScheduler";

describe("dueReminderNumbers (pure)", () => {
  const settings = { firstReminderDays: 7, reminderCount: 3, intervalDays: 7 };

  it("returns nothing before the first threshold", () => {
    expect(dueReminderNumbers(settings, 6, new Set())).toEqual([]);
  });

  it("returns reminder 1 exactly on the first threshold day", () => {
    expect(dueReminderNumbers(settings, 7, new Set())).toEqual([1]);
  });

  it("returns reminder 1 anywhere before the second threshold", () => {
    expect(dueReminderNumbers(settings, 13, new Set())).toEqual([1]);
  });

  it("returns reminders 1 and 2 once both thresholds are reached and neither was sent", () => {
    expect(dueReminderNumbers(settings, 14, new Set())).toEqual([1, 2]);
  });

  it("excludes reminder numbers already recorded as sent", () => {
    expect(dueReminderNumbers(settings, 14, new Set([1]))).toEqual([2]);
  });

  it("never returns more than reminderCount, however far past due", () => {
    expect(dueReminderNumbers(settings, 999, new Set())).toEqual([1, 2, 3]);
  });

  it("returns nothing once all configured reminders were already sent", () => {
    expect(dueReminderNumbers(settings, 999, new Set([1, 2, 3]))).toEqual([]);
  });
});

describe("reminder scheduler (DB-integrated, real local SMTP server)", () => {
  let server: SMTPServer;
  let port: number;
  let received: ParsedMail[] = [];

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth(_auth, _session, callback) {
        callback(null, { user: "test" });
      },
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          simpleParser(Buffer.concat(chunks))
            .then((parsed) => {
              received.push(parsed);
              callback();
            })
            .catch((err) => callback(err));
        });
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const address = server.server.address();
    port = typeof address === "object" && address ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    received = [];
  });

  async function createUser(email: string) {
    return prisma.user.create({ data: { email, passwordHash: "x" } });
  }

  async function createEmailSettings(userId: string) {
    return prisma.emailSettings.create({
      data: {
        userId,
        smtpHost: "127.0.0.1",
        smtpPort: port,
        smtpSecure: false,
        smtpUser: "test@example.com",
        encryptedSmtpPassword: encryptSecret("secret"),
        fromEmail: "faktury@mojafirma.sk",
        fromName: "Moja Firma s.r.o.",
      },
    });
  }

  async function createReminderSettings(userId: string, overrides: Partial<{ enabled: boolean; firstReminderDays: number; reminderCount: number; intervalDays: number }> = {}) {
    return prisma.reminderSettings.create({
      data: {
        userId,
        enabled: overrides.enabled ?? true,
        firstReminderDays: overrides.firstReminderDays ?? 7,
        reminderCount: overrides.reminderCount ?? 3,
        intervalDays: overrides.intervalDays ?? 7,
      },
    });
  }

  async function createInvoice(
    userId: string,
    overrides: Partial<{
      dueDate: string;
      paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
      customerEmail: string | null;
      number: string;
      grossAmountCents: number;
      paidAmountCents: number;
      xml: string | null;
    }> = {}
  ) {
    return prisma.invoice.create({
      data: {
        userId,
        number: overrides.number ?? "2026-0001",
        issueDate: "2026-08-01",
        dueDate: overrides.dueDate ?? "2026-08-01",
        buyerReference: "OBJ-1",
        currency: "EUR",
        status: "GENERATED",
        documentType: "INVOICE",
        paymentStatus: overrides.paymentStatus ?? "UNPAID",
        paidAmountCents: overrides.paidAmountCents ?? 0,
        customerEmail: overrides.customerEmail !== undefined ? overrides.customerEmail : "odberatel@example.com",
        supplierName: "Dodávateľ s.r.o.",
        supplierIco: "11111111",
        supplierDic: "1111111111",
        supplierStreet: "Ulica 1",
        supplierCity: "Bratislava",
        supplierPostalCode: "81101",
        supplierCountry: "SK",
        supplierIban: "SK9711000000002612345678",
        customerName: "Odberateľ s.r.o.",
        customerDic: "2222222222",
        customerStreet: "Ulica 2",
        customerCity: "Košice",
        customerPostalCode: "04001",
        customerCountry: "SK",
        netAmountCents: 10000,
        taxAmountCents: 0,
        grossAmountCents: overrides.grossAmountCents ?? 10000,
        xml: overrides.xml !== undefined ? overrides.xml : "<Invoice><cbc:ID>2026-0001</cbc:ID></Invoice>",
        lines: {
          create: [
            { sortOrder: 0, description: "Položka", quantity: 1, unitCode: "C62", unitPriceCents: 10000, taxRatePercent: 0, lineNetCents: 10000 },
          ],
        },
      },
      include: { lines: true },
    });
  }

  const NOW = new Date("2026-08-30T12:00:00Z"); // fixed "today" for all tests below

  it("sends reminder 1 for an eligible overdue unpaid invoice and logs it as SENT", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" }); // 10 days overdue

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(received).toHaveLength(1);
    expect(received[0].to && "value" in received[0].to ? received[0].to.value[0].address : undefined).toBe("odberatel@example.com");
    expect(received[0].attachments.some((a) => a.filename?.endsWith(".pdf"))).toBe(true);
    expect(received[0].attachments.some((a) => a.filename?.endsWith(".xml"))).toBe(true);

    const logged = await prisma.sentEmail.findMany({ where: { invoiceId: invoice.id } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ type: "REMINDER", reminderNumber: 1, status: "SENT", toEmail: "odberatel@example.com" });
  });

  it("NEVER sends a reminder for a PAID invoice, even if it would otherwise be due", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-01", paymentStatus: "PAID" }); // 29 days "overdue" but paid

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(received).toHaveLength(0);
    expect(await prisma.sentEmail.count()).toBe(0);
  });

  it("NEVER sends a reminder for a CANCELLED invoice, even if it would otherwise be due", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-01", paymentStatus: "CANCELLED" });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(received).toHaveLength(0);
    expect(await prisma.sentEmail.count()).toBe(0);
  });

  it("still reminds a PARTIALLY_PAID invoice — it isn't fully paid yet", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-20", paymentStatus: "PARTIALLY_PAID" });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("does not send twice: a second cycle run is a no-op for the same reminder number", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-20" });

    await runReminderCycle(NOW);
    const second = await runReminderCycle(NOW);
    expect(second).toEqual({ sent: 0, failed: 0 });
    expect(received).toHaveLength(1); // still just the one from the first run
    expect(await prisma.sentEmail.count()).toBe(1);
  });

  it("sends reminder 2 once its threshold is reached, without re-sending reminder 1", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id, { firstReminderDays: 7, intervalDays: 7 });
    await createInvoice(user.id, { dueDate: "2026-08-10" }); // 20 days overdue: 1 (day 7) and 2 (day 14) due, 3 (day 21) not yet

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 2, failed: 0 });
    const logged = await prisma.sentEmail.findMany({ where: { type: "REMINDER" }, orderBy: { reminderNumber: "asc" } });
    expect(logged.map((l) => l.reminderNumber)).toEqual([1, 2]);
  });

  it("skips a company with reminders disabled", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id, { enabled: false });
    await createInvoice(user.id, { dueDate: "2026-08-01" });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("skips a company with no SMTP configured", async () => {
    const user = await createUser("a@example.com");
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-01" });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("records a FAILED attempt with a clear reason when the invoice has no customer email, instead of crashing", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20", customerEmail: null });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(received).toHaveLength(0);
    const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
    expect(logged).toMatchObject({ status: "FAILED" });
    expect(logged?.errorMessage).toMatch(/email odberateľa/);
  });

  it("respects the per-tick cap instead of sending an unbounded burst", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    await createReminderSettings(user.id);
    await createInvoice(user.id, { dueDate: "2026-08-20", number: "2026-0001" });
    await createInvoice(user.id, { dueDate: "2026-08-20", number: "2026-0002" });
    await createInvoice(user.id, { dueDate: "2026-08-20", number: "2026-0003" });

    const result = await runReminderCycle(NOW, 2);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(received).toHaveLength(2);
  });

  it("sendReminderForInvoice sends correctly when called directly with a valid invoice", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" });

    const result = await sendReminderForInvoice(invoice, 1, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].subject).toBe("Subj 2026-0001");
  });

  it("sendReminderForInvoice refuses a PAID invoice even when called directly, bypassing the scheduler's own query filter — this is the defense-in-depth guard, not the query filter tested above", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20", paymentStatus: "PAID" });

    const result = await sendReminderForInvoice(invoice, 1, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(result.success).toBe(false);
    expect(received).toHaveLength(0);
    const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
    expect(logged).toMatchObject({ status: "FAILED" });
    expect(logged?.errorMessage).toMatch(/uhradená/);
  });

  // Regression: sendReminderForInvoice used to trust the `invoice` object it was handed
  // verbatim. collectDueReminders loads every due invoice once at the start of an hourly tick
  // and sends them one at a time — if the invoice got paid (or cancelled) via the API in
  // between, the in-memory copy from earlier in the same tick was still stale and a reminder
  // could go out for an invoice that was, by the time of sending, already settled.
  it("does not send when the invoice was marked PAID in the DB after the in-memory copy was fetched", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const staleInvoice = await createInvoice(user.id, { dueDate: "2026-08-20" }); // still UNPAID in this local variable
    expect(staleInvoice.paymentStatus).toBe("UNPAID");

    await prisma.invoice.update({ where: { id: staleInvoice.id }, data: { paymentStatus: "PAID", paidAmountCents: staleInvoice.grossAmountCents } });

    const result = await sendReminderForInvoice(staleInvoice, 1, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(result.success).toBe(false);
    expect(received).toHaveLength(0);
    const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: staleInvoice.id } });
    expect(logged).toMatchObject({ status: "FAILED" });
    expect(logged?.errorMessage).toMatch(/uhradená/);
  });

  it("reminder email states the outstanding balance, not the full invoice total, once a partial payment was made", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, {
      dueDate: "2026-08-20",
      paymentStatus: "PARTIALLY_PAID",
      grossAmountCents: 100000, // 1000,00 €
      paidAmountCents: 40000, // 400,00 € paid — 600,00 € still owed
    });

    const result = await sendReminderForInvoice(invoice, 1, "Dlží {{amount}}", "Subj");
    expect(result.success).toBe(true);
    expect(received[0].text).toContain("600,00");
    expect(received[0].text).not.toContain("1 000,00");
  });

  it("reminder email states the balance after a credit note too, not just after cash payments", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20", grossAmountCents: 100000 });
    // Mirrors what invoiceController.createCreditNote does: a CREDIT_NOTE row referencing this
    // invoice (200,00 € credited), plus the resulting PARTIALLY_PAID status on the original.
    await prisma.invoice.create({
      data: {
        userId: user.id,
        number: "DB-1",
        issueDate: "2026-08-20",
        dueDate: "2026-08-20",
        buyerReference: "OBJ-1",
        currency: "EUR",
        documentType: "CREDIT_NOTE",
        originalInvoiceId: invoice.id,
        supplierName: "Dodávateľ s.r.o.",
        supplierIco: "11111111",
        supplierDic: "1111111111",
        supplierStreet: "Ulica 1",
        supplierCity: "Bratislava",
        supplierPostalCode: "81101",
        supplierCountry: "SK",
        supplierIban: "SK9711000000002612345678",
        customerName: "Odberateľ s.r.o.",
        customerDic: "2222222222",
        customerStreet: "Ulica 2",
        customerCity: "Košice",
        customerPostalCode: "04001",
        customerCountry: "SK",
        netAmountCents: 20000,
        taxAmountCents: 0,
        grossAmountCents: 20000,
      },
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { paymentStatus: "PARTIALLY_PAID" } });

    const result = await sendReminderForInvoice(invoice, 1, "Dlží {{amount}}", "Subj");
    expect(result.success).toBe(true);
    expect(received[0].text).toContain("800,00"); // 1000,00 - 200,00 credited
  });

  it("records a FAILED attempt with a clear reason when the invoice has no generated XML yet, instead of mailing an empty attachment", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20", xml: null });

    const result = await sendReminderForInvoice(invoice, 1, "Text", "Subj");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/XML/);
    expect(received).toHaveLength(0);
    const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
    expect(logged).toMatchObject({ status: "FAILED" });
  });

  it("refuses a second manual send (reminderNumber 0) within the cooldown window, so repeated clicks or a scripted loop can't spam the customer", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" });

    const first = await sendReminderForInvoice(invoice, 0, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(first.success).toBe(true);

    const second = await sendReminderForInvoice(invoice, 0, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/nedávno odoslaná/);
    expect(received).toHaveLength(1); // only the first send actually went out over SMTP

    const logged = await prisma.sentEmail.findMany({ where: { invoiceId: invoice.id }, orderBy: { sentAt: "asc" } });
    expect(logged.map((l) => l.status)).toEqual(["SENT", "FAILED"]);
  });

  it("the manual-send cooldown never blocks scheduled reminders — a different reminderNumber is unaffected", async () => {
    const user = await createUser("a@example.com");
    await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" });

    await sendReminderForInvoice(invoice, 0, "Text", "Subj"); // manual send, logs reminderNumber 0
    const scheduled = await sendReminderForInvoice(invoice, 1, "Text", "Subj"); // a real scheduled reminder right after
    expect(scheduled.success).toBe(true);
    expect(received).toHaveLength(2);
  });

  it("sendReminderForInvoice always reads current EmailSettings, not a value captured earlier", async () => {
    const user = await createUser("a@example.com");
    await prisma.emailSettings.create({
      data: {
        userId: user.id,
        smtpHost: "127.0.0.1",
        smtpPort: 1, // nothing listens here — this attempt must fail
        smtpSecure: false,
        smtpUser: "test@example.com",
        encryptedSmtpPassword: encryptSecret("secret"),
        fromEmail: "faktury@mojafirma.sk",
        fromName: "Moja Firma s.r.o.",
      },
    });
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" });

    const first = await sendReminderForInvoice(invoice, 1, "Text", "Subj");
    expect(first.success).toBe(false);

    await prisma.emailSettings.update({ where: { userId: user.id }, data: { smtpPort: port } });
    const second = await sendReminderForInvoice(invoice, 2, "Text", "Subj");
    expect(second.success).toBe(true); // proves this call picked up the just-updated port, not a cached value
    expect(received).toHaveLength(1);
  });

  it("correctly processes multiple companies' due reminders in one batched cycle, keeping each invoice with its own company's settings", async () => {
    const userA = await createUser("a@example.com");
    const userB = await createUser("b@example.com");
    await createEmailSettings(userA.id);
    await createEmailSettings(userB.id);
    await createReminderSettings(userA.id);
    await createReminderSettings(userB.id);
    const invoiceA = await createInvoice(userA.id, { dueDate: "2026-08-20", number: "A-1" });
    const invoiceB = await createInvoice(userB.id, { dueDate: "2026-08-20", number: "B-1", customerEmail: "b-customer@example.com" });

    const result = await runReminderCycle(NOW);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(received).toHaveLength(2);
    const recipients = received.map((m) => (m.to && "value" in m.to ? m.to.value[0].address : undefined)).sort();
    expect(recipients).toEqual(["b-customer@example.com", "odberatel@example.com"]);

    const loggedA = await prisma.sentEmail.findFirst({ where: { invoiceId: invoiceA.id } });
    const loggedB = await prisma.sentEmail.findFirst({ where: { invoiceId: invoiceB.id } });
    expect(loggedA?.userId).toBe(userA.id);
    expect(loggedB?.userId).toBe(userB.id);
  });

  it("a single throwing item does not abort the rest of the cycle — other companies still get their reminders", async () => {
    const poisoned = await createUser("poisoned@example.com");
    const healthy = await createUser("healthy@example.com");
    // A malformed encryptedSmtpPassword makes decryptSecret throw synchronously.
    await prisma.emailSettings.create({
      data: {
        userId: poisoned.id,
        smtpHost: "127.0.0.1",
        smtpPort: port,
        smtpSecure: false,
        smtpUser: "test@example.com",
        encryptedSmtpPassword: "not-a-valid-encrypted-value",
        fromEmail: "faktury@mojafirma.sk",
        fromName: "Poisoned s.r.o.",
      },
    });
    await createReminderSettings(poisoned.id);
    await createInvoice(poisoned.id, { dueDate: "2026-08-20", number: "P-1" });

    await createEmailSettings(healthy.id);
    await createReminderSettings(healthy.id);
    const healthyInvoice = await createInvoice(healthy.id, { dueDate: "2026-08-20", number: "H-1", customerEmail: "healthy-customer@example.com" });

    const result = await runReminderCycle(NOW);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].to && "value" in received[0].to ? received[0].to.value[0].address : undefined).toBe("healthy-customer@example.com");

    const healthyLog = await prisma.sentEmail.findFirst({ where: { invoiceId: healthyInvoice.id } });
    expect(healthyLog).toMatchObject({ status: "SENT" });
  });
});
