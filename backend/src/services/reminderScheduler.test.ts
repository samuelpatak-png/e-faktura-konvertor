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
        xml: "<Invoice><cbc:ID>2026-0001</cbc:ID></Invoice>",
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
    const emailSettings = await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20" });

    const result = await sendReminderForInvoice(invoice, emailSettings, 1, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].subject).toBe("Subj 2026-0001");
  });

  it("sendReminderForInvoice refuses a PAID invoice even when called directly, bypassing the scheduler's own query filter — this is the defense-in-depth guard, not the query filter tested above", async () => {
    const user = await createUser("a@example.com");
    const emailSettings = await createEmailSettings(user.id);
    const invoice = await createInvoice(user.id, { dueDate: "2026-08-20", paymentStatus: "PAID" });

    const result = await sendReminderForInvoice(invoice, emailSettings, 1, "Text {{invoiceNumber}}", "Subj {{invoiceNumber}}");
    expect(result.success).toBe(false);
    expect(received).toHaveLength(0);
    const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
    expect(logged).toMatchObject({ status: "FAILED" });
    expect(logged?.errorMessage).toMatch(/uhradená/);
  });
});
