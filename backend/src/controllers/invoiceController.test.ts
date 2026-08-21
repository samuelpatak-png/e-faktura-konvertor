import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/crypto";
import * as invoiceController from "./invoiceController";

// Same pdftotext-based extraction as pdfGenerator.test.ts, used here to prove the real DB ->
// controller -> PDF pipeline (not just generateInvoicePdf in isolation) renders the correct
// current balance — skipped everywhere pdftotext isn't installed.
function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function extractPdfText(pdfBytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "invoice-controller-pdf-test-"));
  const pdfPath = join(dir, "doc.pdf");
  writeFileSync(pdfPath, pdfBytes);
  try {
    return execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mockReq(userId: string, overrides: Partial<{ params: Record<string, string>; query: Record<string, string>; body: unknown }> = {}): Request {
  return { userId, params: {}, query: {}, body: {}, ...overrides } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data?: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
}

async function createUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

async function createInvoice(
  userId: string,
  overrides: Partial<{ number: string; dueDate: string; grossAmountCents: number; paidAmountCents: number; paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED"; documentType: "INVOICE" | "CREDIT_NOTE" | "ADVANCE_TAX_DOCUMENT"; originalInvoiceId: string; supplierIcDph: string | null; xml: string | null; prepaidAmountCents: number; customerEmail: string | null }> = {}
) {
  return prisma.invoice.create({
    data: {
      userId,
      number: overrides.number ?? "2026-0001",
      issueDate: "2026-08-01",
      dueDate: overrides.dueDate ?? "2026-08-15",
      buyerReference: "OBJ-1",
      currency: "EUR",
      status: "GENERATED",
      supplierName: "Dodávateľ s.r.o.",
      supplierIco: "11111111",
      supplierDic: "1111111111",
      supplierIcDph: overrides.supplierIcDph !== undefined ? overrides.supplierIcDph : "SK1111111111",
      documentType: overrides.documentType ?? "INVOICE",
      originalInvoiceId: overrides.originalInvoiceId,
      paidAmountCents: overrides.paidAmountCents ?? 0,
      paymentStatus: overrides.paymentStatus ?? "UNPAID",
      prepaidAmountCents: overrides.prepaidAmountCents,
      xml: overrides.xml !== undefined ? overrides.xml : "<Invoice><cbc:ID>2026-0001</cbc:ID></Invoice>",
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
      customerEmail: overrides.customerEmail !== undefined ? overrides.customerEmail : "odberatel@example.com",
      netAmountCents: 10000,
      taxAmountCents: 0,
      grossAmountCents: overrides.grossAmountCents ?? 10000,
      lines: {
        create: [
          {
            sortOrder: 0,
            description: "Konzultačné služby",
            quantity: 1,
            unitCode: "C62",
            unitPriceCents: overrides.grossAmountCents ?? 10000,
            taxRatePercent: 0,
            lineNetCents: overrides.grossAmountCents ?? 10000,
          },
        ],
      },
    },
  });
}

async function createCompanyProfile(userId: string, overrides: Partial<{ icDph: string | null }> = {}) {
  return prisma.companyProfile.create({
    data: {
      userId,
      name: "Dodávateľ s.r.o.",
      ico: "11111111",
      dic: "1111111111",
      icDph: overrides.icDph !== undefined ? overrides.icDph : "SK1111111111",
      street: "Ulica 1",
      city: "Bratislava",
      postalCode: "81101",
      country: "SK",
      iban: "SK9711000000002612345678",
    },
  });
}

// WP7: a real local SMTP server (not a mock of nodemailer) for send-email controller tests —
// see emailSender.test.ts for why. Module-scoped (not inside one describe block) so both the
// sendInvoiceEmail and sendReminderNow test groups below can use it.
let emailTestServer: SMTPServer;
let emailTestPort: number;
let receivedEmails: ParsedMail[] = [];

beforeAll(async () => {
  emailTestServer = new SMTPServer({
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
            receivedEmails.push(parsed);
            callback();
          })
          .catch((err) => callback(err));
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    emailTestServer.listen(0, "127.0.0.1", () => resolve());
    emailTestServer.on("error", reject);
  });
  const address = emailTestServer.server.address();
  emailTestPort = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => emailTestServer.close(() => resolve()));
});

afterEach(() => {
  receivedEmails = [];
});

async function createEmailSettings(userId: string) {
  return prisma.emailSettings.create({
    data: {
      userId,
      smtpHost: "127.0.0.1",
      smtpPort: emailTestPort,
      smtpSecure: false,
      smtpUser: "test@example.com",
      encryptedSmtpPassword: encryptSecret("secret"),
      fromEmail: "faktury@mojafirma.sk",
      fromName: "Moja Firma s.r.o.",
    },
  });
}


function validInvoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "Odberateľ s.r.o.", dic: "2222222222", street: "Ulica 2", city: "Košice", postalCode: "04001", country: "SK" },
    number: "2026-0001",
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    buyerReference: "OBJ-1",
    lines: [{ description: "Položka", quantity: 1, unitCode: "C62", unitPrice: 100, taxRatePercent: 0 }],
    ...overrides,
  };
}

describe("invoiceController generateInvoice — WP4 additions", () => {
  it("rejects an advance tax document from a non-VAT-registered supplier", async () => {
    const user = await createUser("vatless@example.com");
    await createCompanyProfile(user.id, { icDph: null });
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ isAdvanceTaxDocument: true }) }), res);
    expect(res.statusCode).toBe(400);
  });

  it("allows an advance tax document from a VAT-registered supplier and records InvoiceTypeCode 386", async () => {
    const user = await createUser("vat@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ isAdvanceTaxDocument: true }) }), res);
    expect(res.statusCode).toBe(201);
    const xml = (res.body as { xml: string }).xml;
    expect(xml).toContain("<cbc:InvoiceTypeCode>386</cbc:InvoiceTypeCode>");

    const stored = await prisma.invoice.findUnique({ where: { id: (res.body as { invoiceId: string }).invoiceId } });
    expect(stored?.documentType).toBe("ADVANCE_TAX_DOCUMENT");
  });

  it("rejects a prepaid amount larger than the invoice total", async () => {
    const user = await createUser("prepay-over@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ prepaidAmountCents: 100_001 }) }), res);
    expect(res.statusCode).toBe(400);
  });

  it("marks a fully-prepaid invoice PAID immediately on creation", async () => {
    const user = await createUser("prepay-full@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ prepaidAmountCents: 10000 }) }), res);
    expect(res.statusCode).toBe(201);

    const stored = await prisma.invoice.findUnique({ where: { id: (res.body as { invoiceId: string }).invoiceId } });
    expect(stored?.paymentStatus).toBe("PAID");
    expect(stored?.paidAmountCents).toBe(10000);
    expect(stored?.paidAt).not.toBeNull();
  });

  it("marks a partially-prepaid invoice PARTIALLY_PAID on creation", async () => {
    const user = await createUser("prepay-partial@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ prepaidAmountCents: 4000 }) }), res);
    expect(res.statusCode).toBe(201);

    const stored = await prisma.invoice.findUnique({ where: { id: (res.body as { invoiceId: string }).invoiceId } });
    expect(stored?.paymentStatus).toBe("PARTIALLY_PAID");
    expect(stored?.paidAmountCents).toBe(4000);
  });

  // Regression: a 386 ("daňový doklad k prijatej platbe") IS itself the document confirming a
  // payment was received — it used to sit UNPAID forever (paidAmountCents only ever came from
  // prepaidAmountCents, which a 386 never has one of), which could then show up as overdue.
  it("marks an ADVANCE_TAX_DOCUMENT (386) PAID in full immediately, with no prepaidAmountCents of its own", async () => {
    const user = await createUser("advance-paid@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(mockReq(user.id, { body: validInvoiceBody({ isAdvanceTaxDocument: true }) }), res);
    expect(res.statusCode).toBe(201);

    const stored = await prisma.invoice.findUnique({ where: { id: (res.body as { invoiceId: string }).invoiceId } });
    expect(stored?.paymentStatus).toBe("PAID");
    expect(stored?.paidAmountCents).toBe(stored?.grossAmountCents);
    expect(stored?.paidAt).not.toBeNull();

    // Already excluded from the unpaid dashboard by documentType alone, but confirm the count too.
    const summaryRes = mockRes();
    await invoiceController.getUnpaidSummary(mockReq(user.id), summaryRes);
    expect((summaryRes.body as { count: number }).count).toBe(0);
  });

  it("rejects isAdvanceTaxDocument combined with its own prepaidAmountCents (schema refine)", async () => {
    const user = await createUser("advance-plus-prepaid@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.generateInvoice(
      mockReq(user.id, { body: validInvoiceBody({ isAdvanceTaxDocument: true, prepaidAmountCents: 4000 }) }),
      res
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("invoiceController validateInvoice — WP4/prepaid cap", () => {
  it("rejects a prepaid amount larger than the invoice total, same as /generate", async () => {
    const user = await createUser("validate-prepay-over@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.validateInvoice(mockReq(user.id, { body: validInvoiceBody({ prepaidAmountCents: 100_001 }) }), res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });

  it("still validates normally when there's no prepaid amount", async () => {
    const user = await createUser("validate-ok@example.com");
    await createCompanyProfile(user.id);
    const res = mockRes();
    await invoiceController.validateInvoice(mockReq(user.id, { body: validInvoiceBody() }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { valid: boolean }).valid).toBe(true);
  });
});

describe("invoiceController — a CREDIT_NOTE's fake dueDate placeholder is never treated as a real due date", () => {
  it("getInvoice reports overdue: false for a credit note regardless of how old its issueDate is", async () => {
    const user = await createUser("credit-overdue@example.com");
    await createCompanyProfile(user.id);
    const oldDate = "2020-01-01"; // long past — would be "overdue" if treated as a real dueDate
    const creditNote = await createInvoice(user.id, { documentType: "CREDIT_NOTE", dueDate: oldDate });

    const res = mockRes();
    await invoiceController.getInvoice(mockReq(user.id, { params: { id: creditNote.id } }), res);
    expect((res.body as { overdue: boolean; daysOverdue: number }).overdue).toBe(false);
    expect((res.body as { daysOverdue: number }).daysOverdue).toBe(0);
  });

  it("listInvoices reports the same for a credit note in the list view", async () => {
    const user = await createUser("credit-overdue-list@example.com");
    await createCompanyProfile(user.id);
    await createInvoice(user.id, { documentType: "CREDIT_NOTE", dueDate: "2020-01-01" });

    const res = mockRes();
    await invoiceController.listInvoices(mockReq(user.id), res);
    const [creditNote] = res.body as { overdue: boolean }[];
    expect(creditNote.overdue).toBe(false);
  });
});

describe("invoiceController payments", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createUser("a@example.com");
    userB = await createUser("b@example.com");
  });

  describe("recordPayment", () => {
    it("includes `lines` in the response — the frontend re-renders the full invoice detail from it", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 100 } }), res);
      expect(Array.isArray((res.body as { lines: unknown }).lines)).toBe(true);
    });

    // Regression: InvoiceDetailPage.tsx computes creditedCents from `invoice.corrections`
    // unconditionally (invoice.corrections.reduce(...)) — omitting it here (unlike getInvoice,
    // which always includes it) crashed the page with "Cannot read properties of undefined
    // (reading 'reduce')" immediately after recording a payment.
    it("includes `corrections` in the response too, same shape as getInvoice", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 100 } }), res);
      expect(Array.isArray((res.body as { corrections: unknown }).corrections)).toBe(true);
    });

    it("records a partial payment and sets paymentStatus to PARTIALLY_PAID", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 4000 } }), res);
      expect(res.statusCode).toBe(200);
      const body = res.body as { paidAmountCents: number; paymentStatus: string };
      expect(body.paidAmountCents).toBe(4000);
      expect(body.paymentStatus).toBe("PARTIALLY_PAID");
    });

    it("marks PAID and sets paidAt on an exact-to-the-cent payment", async () => {
      const invoice = await createInvoice(userA.id, { grossAmountCents: 10000 });
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 10000 } }), res);
      expect(res.statusCode).toBe(200);
      const body = res.body as { paidAmountCents: number; paymentStatus: string; paidAt: string | null };
      expect(body.paidAmountCents).toBe(10000);
      expect(body.paymentStatus).toBe("PAID");
      expect(body.paidAt).not.toBeNull();
    });

    it("accumulates multiple partial payments up to PAID", async () => {
      const invoice = await createInvoice(userA.id, { grossAmountCents: 10000 });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 6000 } }), mockRes());
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 4000 } }), res);
      const body = res.body as { paidAmountCents: number; paymentStatus: string };
      expect(body.paidAmountCents).toBe(10000);
      expect(body.paymentStatus).toBe("PAID");
    });

    it("rejects a payment that would exceed the invoice total (overpayment)", async () => {
      const invoice = await createInvoice(userA.id, { grossAmountCents: 10000 });
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 10001 } }), res);
      expect(res.statusCode).toBe(400);

      const stored = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      expect(stored?.paidAmountCents).toBe(0);
    });

    it("rejects any payment on a cancelled invoice", async () => {
      const invoice = await createInvoice(userA.id);
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: invoice.id } }), mockRes());

      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 100 } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("refuses to record a payment on a credit note", async () => {
      const creditNote = await createInvoice(userA.id, { documentType: "CREDIT_NOTE" });
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: creditNote.id }, body: { amountCents: 100 } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("user A cannot record a payment on user B's invoice", async () => {
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 100 } }), res);
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      expect(stillB?.paidAmountCents).toBe(0);
    });
  });

  describe("cancelInvoice", () => {
    it("cancels an unpaid invoice", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { paymentStatus: string }).paymentStatus).toBe("CANCELLED");
      expect(Array.isArray((res.body as { lines: unknown }).lines)).toBe(true);
      expect(Array.isArray((res.body as { corrections: unknown }).corrections)).toBe(true);
    });

    it("refuses to cancel a fully paid invoice", async () => {
      const invoice = await createInvoice(userA.id, { grossAmountCents: 10000 });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 10000 } }), mockRes());

      const res = mockRes();
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("refuses to cancel a credit note", async () => {
      const creditNote = await createInvoice(userA.id, { documentType: "CREDIT_NOTE" });
      const res = mockRes();
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: creditNote.id } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("user A cannot cancel user B's invoice", async () => {
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      expect(stillB?.paymentStatus).toBe("UNPAID");
    });
  });

  describe("overdue derivation on getInvoice/listInvoices", () => {
    it("reports a past-due unpaid invoice as overdue with a positive daysOverdue", async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 10);
      const invoice = await createInvoice(userA.id, { dueDate: pastDue.toISOString().slice(0, 10) });

      const res = mockRes();
      await invoiceController.getInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
      const body = res.body as { overdue: boolean; daysOverdue: number };
      expect(body.overdue).toBe(true);
      expect(body.daysOverdue).toBeGreaterThanOrEqual(10);
    });

    it("reports a due-today invoice as not overdue", async () => {
      const invoice = await createInvoice(userA.id, { dueDate: new Date().toISOString().slice(0, 10) });
      const res = mockRes();
      await invoiceController.getInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect((res.body as { overdue: boolean }).overdue).toBe(false);
    });
  });

  describe("getUnpaidSummary", () => {
    it("sums outstanding amounts and buckets by age, excluding paid/cancelled invoices", async () => {
      const paid = await createInvoice(userA.id, { number: "PAID-1", grossAmountCents: 5000 });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: paid.id }, body: { amountCents: 5000 } }), mockRes());

      const cancelled = await createInvoice(userA.id, { number: "CANCEL-1" });
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: cancelled.id } }), mockRes());

      const notDue = new Date();
      notDue.setDate(notDue.getDate() + 10);
      await createInvoice(userA.id, { number: "NOTDUE-1", dueDate: notDue.toISOString().slice(0, 10), grossAmountCents: 3000 });

      const overdue40 = new Date();
      overdue40.setDate(overdue40.getDate() - 40);
      await createInvoice(userA.id, { number: "OVERDUE-40", dueDate: overdue40.toISOString().slice(0, 10), grossAmountCents: 7000 });

      const res = mockRes();
      await invoiceController.getUnpaidSummary(mockReq(userA.id), res);
      const body = res.body as {
        totalOutstandingCents: number;
        count: number;
        buckets: Record<string, { count: number; amountCents: number }>;
      };

      expect(body.count).toBe(2);
      expect(body.totalOutstandingCents).toBe(10000);
      expect(body.buckets.notYetDue).toEqual({ count: 1, amountCents: 3000 });
      expect(body.buckets.days31to60).toEqual({ count: 1, amountCents: 7000 });
      expect(body.buckets.days0to30).toEqual({ count: 0, amountCents: 0 });
    });

    it("only includes the authenticated user's invoices", async () => {
      await createInvoice(userB.id, { number: "B-1" });
      const res = mockRes();
      await invoiceController.getUnpaidSummary(mockReq(userA.id), res);
      expect((res.body as { count: number }).count).toBe(0);
    });

    it("excludes credit notes and advance tax documents from the receivables total", async () => {
      await createInvoice(userA.id, { number: "DB-1", documentType: "CREDIT_NOTE", grossAmountCents: 999999 });
      await createInvoice(userA.id, { number: "DP-1", documentType: "ADVANCE_TAX_DOCUMENT", grossAmountCents: 999999 });
      const res = mockRes();
      await invoiceController.getUnpaidSummary(mockReq(userA.id), res);
      expect((res.body as { count: number }).count).toBe(0);
      expect((res.body as { totalOutstandingCents: number }).totalOutstandingCents).toBe(0);
    });
  });

  describe("createCreditNote", () => {
    it("credits the original invoice in full when no lines are supplied", async () => {
      const original = await createInvoice(userA.id, { grossAmountCents: 10000 });
      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        res
      );
      expect(res.statusCode).toBe(201);

      const stored = await prisma.invoice.findUnique({ where: { id: (res.body as { invoiceId: string }).invoiceId } });
      expect(stored?.documentType).toBe("CREDIT_NOTE");
      expect(stored?.originalInvoiceId).toBe(original.id);
      expect(stored?.grossAmountCents).toBe(10000);
    });

    it("rejects a credit note whose lines would exceed the original invoice total", async () => {
      const original = await createInvoice(userA.id, { grossAmountCents: 10000 });
      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: {
            number: "DB-1",
            issueDate: "2026-08-20",
            lines: [{ description: "Nadmerný dobropis", quantity: 1, unitCode: "C62", unitPrice: 200, taxRatePercent: 0 }],
          },
        }),
        res
      );
      expect(res.statusCode).toBe(400);
    });

    it("rejects a second credit note once the first already used up the full original amount", async () => {
      const original = await createInvoice(userA.id, { grossAmountCents: 10000 });
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        mockRes()
      );

      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: {
            number: "DB-2",
            issueDate: "2026-08-21",
            lines: [{ description: "Ďalší dobropis", quantity: 1, unitCode: "C62", unitPrice: 1, taxRatePercent: 0 }],
          },
        }),
        res
      );
      expect(res.statusCode).toBe(400);
    });

    it("allows a partial credit note that leaves room for a second one within the original total", async () => {
      const original = await createInvoice(userA.id, { grossAmountCents: 10000 });
      const first = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: {
            number: "DB-1",
            issueDate: "2026-08-20",
            lines: [{ description: "Čiastočný dobropis", quantity: 1, unitCode: "C62", unitPrice: 40, taxRatePercent: 0 }],
          },
        }),
        first
      );
      expect(first.statusCode).toBe(201);

      const second = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: {
            number: "DB-2",
            issueDate: "2026-08-21",
            lines: [{ description: "Zvyšný dobropis", quantity: 1, unitCode: "C62", unitPrice: 60, taxRatePercent: 0 }],
          },
        }),
        second
      );
      expect(second.statusCode).toBe(201);
    });

    it("refuses to credit-note a cancelled invoice", async () => {
      const original = await createInvoice(userA.id);
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: original.id } }), mockRes());

      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        res
      );
      expect(res.statusCode).toBe(400);
    });

    it("refuses to credit-note a credit note", async () => {
      const creditNote = await createInvoice(userA.id, { documentType: "CREDIT_NOTE" });
      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: creditNote.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        res
      );
      expect(res.statusCode).toBe(400);
    });

    it("user A cannot credit-note user B's invoice", async () => {
      const original = await createInvoice(userB.id, { grossAmountCents: 10000 });
      const res = mockRes();
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        res
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // Bug cluster 1+2+6: a credit note used to only create the CREDIT_NOTE row — the original
  // invoice's own paidAmountCents/paymentStatus, the unpaid dashboard, recordPayment's cap, the
  // PDF/QR payable amount, and the reminder scheduler all kept treating the original as if
  // nothing had been credited away.
  describe("createCreditNote — updates the original invoice's outstanding balance/status", () => {
    it("a partial credit note reduces the original's paymentStatus to PARTIALLY_PAID and getUnpaidSummary's outstanding total", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-1", grossAmountCents: 100000 });
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: { number: "DB-1", issueDate: "2026-08-20", lines: [{ description: "Čiastočný dobropis", quantity: 1, unitCode: "C62", unitPrice: 300, taxRatePercent: 0 }] },
        }),
        mockRes()
      );

      const stored = await prisma.invoice.findUnique({ where: { id: original.id } });
      expect(stored?.paymentStatus).toBe("PARTIALLY_PAID");
      expect(stored?.paidAmountCents).toBe(0); // credit notes never touch actual cash-received tracking

      const summaryRes = mockRes();
      await invoiceController.getUnpaidSummary(mockReq(userA.id), summaryRes);
      expect((summaryRes.body as { totalOutstandingCents: number }).totalOutstandingCents).toBe(70000); // 1000 - 300 credited
    });

    it("a full credit note marks the original PAID and removes it from getUnpaidSummary", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-2", grossAmountCents: 10000 });
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        mockRes()
      );

      const stored = await prisma.invoice.findUnique({ where: { id: original.id } });
      expect(stored?.paymentStatus).toBe("PAID");
      expect(stored?.paidAt).not.toBeNull();

      const summaryRes = mockRes();
      await invoiceController.getUnpaidSummary(mockReq(userA.id), summaryRes);
      expect((summaryRes.body as { count: number }).count).toBe(0);
    });

    it("a partial payment followed by a full-remaining credit note settles the invoice without double counting", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-3", grossAmountCents: 10000 });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: original.id }, body: { amountCents: 4000 } }), mockRes());
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: { number: "DB-1", issueDate: "2026-08-20", lines: [{ description: "Zvyšok dobropisom", quantity: 1, unitCode: "C62", unitPrice: 60, taxRatePercent: 0 }] },
        }),
        mockRes()
      );
      const stored = await prisma.invoice.findUnique({ where: { id: original.id } });
      expect(stored?.paidAmountCents).toBe(4000); // untouched — only the derived status changes
      expect(stored?.paymentStatus).toBe("PAID");
    });

    it("once fully credited, recordPayment rejects any further payment (the credited-aware cap)", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-4", grossAmountCents: 10000 });
      await invoiceController.createCreditNote(
        mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-1", issueDate: "2026-08-20" } }),
        mockRes()
      );
      const res = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: original.id }, body: { amountCents: 1 } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("a partial credit note lowers recordPayment's cap by the credited amount", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-5", grossAmountCents: 10000 });
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: { number: "DB-1", issueDate: "2026-08-20", lines: [{ description: "Dobropis", quantity: 1, unitCode: "C62", unitPrice: 30, taxRatePercent: 0 }] },
        }),
        mockRes()
      );
      // 30 credited + 71 paid would exceed the 100 total by 1 cent.
      const overRes = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: original.id }, body: { amountCents: 7100 } }), overRes);
      expect(overRes.statusCode).toBe(400);

      const okRes = mockRes();
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: original.id }, body: { amountCents: 7000 } }), okRes);
      expect(okRes.statusCode).toBe(200);
      expect((okRes.body as { paymentStatus: string }).paymentStatus).toBe("PAID");
    });

    // Two credit notes issued at nearly the same instant against the same invoice must not both
    // read "nothing credited yet" and both pass the cap check — only one should be able to use
    // up the invoice's full remaining amount.
    it("two concurrent full-amount credit notes against the same invoice — only one succeeds", async () => {
      const original = await createInvoice(userA.id, { number: "ORIG-RACE-1", grossAmountCents: 10000 });
      const resA = mockRes();
      const resB = mockRes();
      await Promise.all([
        invoiceController.createCreditNote(
          mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-RACE-A", issueDate: "2026-08-20" } }),
          resA
        ),
        invoiceController.createCreditNote(
          mockReq(userA.id, { params: { id: original.id }, body: { number: "DB-RACE-B", issueDate: "2026-08-20" } }),
          resB
        ),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 400]);

      const totalCredited = await prisma.invoice.aggregate({
        where: { originalInvoiceId: original.id, documentType: "CREDIT_NOTE" },
        _sum: { grossAmountCents: true },
      });
      expect(totalCredited._sum.grossAmountCents).toBe(10000); // not 20000 — the loser never committed
    });

    it("PDF and email both state the same current balance after a partial payment and a partial credit note", async () => {
      await createEmailSettings(userA.id);
      const original = await createInvoice(userA.id, {
        number: "ORIG-6",
        grossAmountCents: 100000,
        customerEmail: "odberatel@example.com",
      });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: original.id }, body: { amountCents: 30000 } }), mockRes());
      await invoiceController.createCreditNote(
        mockReq(userA.id, {
          params: { id: original.id },
          body: { number: "DB-1", issueDate: "2026-08-20", lines: [{ description: "Dobropis", quantity: 1, unitCode: "C62", unitPrice: 200, taxRatePercent: 0 }] },
        }),
        mockRes()
      );

      const emailRes = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: original.id } }), emailRes);
      expect(emailRes.statusCode).toBe(200);
      expect(receivedEmails[receivedEmails.length - 1].text).toContain("500,00"); // 1000 - 300 paid - 200 credited

      const pdfRes = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: original.id } }), pdfRes);
      expect(pdfRes.statusCode).toBe(200);
      if (hasPdftotext()) {
        const text = extractPdfText(pdfRes.body as Buffer);
        expect(text).toContain("500,00");
      }
    });
  });

  describe("recordPayment — concurrency (TOCTOU)", () => {
    it("two concurrent payments racing for the last of the balance don't both succeed and overshoot the total", async () => {
      const invoice = await createInvoice(userA.id, { number: "PAY-RACE-1", grossAmountCents: 10000 });
      const resA = mockRes();
      const resB = mockRes();
      await Promise.all([
        invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 6000 } }), resA),
        invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 6000 } }), resB),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([200, 400]); // one accepted (6000/10000), the other would overshoot to 12000

      const stored = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      expect(stored?.paidAmountCents).toBe(6000); // not 12000 — no lost update, no overshoot
    });
  });

  describe("downloadInvoicePdf", () => {
    it("streams a valid PDF for a generated invoice, even with no CompanyProfile branding on file", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(200);
      const body = res.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.subarray(0, 4).toString()).toBe("%PDF");
    });

    it("returns 404 for a non-existent invoice", async () => {
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: "does-not-exist" } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when the invoice has no generated xml yet", async () => {
      const invoice = await createInvoice(userA.id, { xml: null });
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("user A cannot download user B's invoice as a PDF", async () => {
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("produces a valid PDF for a credit note despite the DB's non-meaningful dueDate placeholder", async () => {
      const invoice = await createInvoice(userA.id, { documentType: "CREDIT_NOTE" });
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(200);
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    });

    it("embeds current CompanyProfile branding rather than a snapshot, without throwing", async () => {
      await createCompanyProfile(userA.id);
      const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      );
      await prisma.companyProfile.update({
        where: { userId: userA.id },
        data: { logoData: tinyPng.toString("base64"), logoMimeType: "image/png" },
      });
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.downloadInvoicePdf(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(200);
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    });
  });

  describe("sendInvoiceEmail", () => {
    it("sends a real email with PDF+XML attachments to the invoice's saved customerEmail and logs it as SENT", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id, { customerEmail: "odberatel@example.com" });

      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(200);
      expect(receivedEmails).toHaveLength(1);
      const msg = receivedEmails[0];
      expect(msg.to && "value" in msg.to ? msg.to.value[0].address : undefined).toBe("odberatel@example.com");
      expect(msg.attachments.some((a) => a.filename?.endsWith(".pdf"))).toBe(true);
      expect(msg.attachments.some((a) => a.filename?.endsWith(".xml"))).toBe(true);

      const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
      expect(logged).toMatchObject({ type: "INVOICE", status: "SENT", toEmail: "odberatel@example.com" });
    });

    it("uses an explicit `to` override instead of the invoice's saved customerEmail when one is given", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id, { customerEmail: "saved@example.com" });

      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id }, body: { to: "override@example.com" } }), res);

      expect(res.statusCode).toBe(200);
      const msg = receivedEmails[0];
      expect(msg.to && "value" in msg.to ? msg.to.value[0].address : undefined).toBe("override@example.com");
    });

    it("rejects with a clear message when the invoice has no customerEmail and no override was given", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id, { customerEmail: null });

      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(400);
      expect(receivedEmails).toHaveLength(0);
    });

    it("rejects with a clear message when SMTP hasn't been configured yet", async () => {
      const invoice = await createInvoice(userA.id);
      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(400);
      expect(receivedEmails).toHaveLength(0);
    });

    it("returns 404 for a non-existent invoice", async () => {
      await createEmailSettings(userA.id);
      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: "does-not-exist" } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("user A cannot email user B's invoice", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);
      expect(receivedEmails).toHaveLength(0);
    });

    it("states the outstanding balance, not the full total, for a partially-paid invoice", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id, {
        customerEmail: "odberatel@example.com",
        grossAmountCents: 100000,
        paidAmountCents: 40000,
        paymentStatus: "PARTIALLY_PAID",
      });

      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(200);
      expect(receivedEmails[0].text).toContain("600,00");
      expect(receivedEmails[0].text).not.toContain("1 000,00");
    });

    it("shows no due date for a credit note instead of the issueDate placeholder the DB column holds", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id, { customerEmail: "odberatel@example.com", documentType: "CREDIT_NOTE" });

      const res = mockRes();
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(200);
      expect(receivedEmails[0].text).toContain("—");
      expect(receivedEmails[0].text).not.toContain("15.08.2026"); // the placeholder dueDate createInvoice sets by default
    });
  });

  describe("sendReminderNow", () => {
    it("sends a manual reminder for an eligible invoice", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id);

      const res = mockRes();
      await invoiceController.sendReminderNow(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(200);
      expect(receivedEmails).toHaveLength(1);
      const logged = await prisma.sentEmail.findFirst({ where: { invoiceId: invoice.id } });
      expect(logged).toMatchObject({ type: "REMINDER", reminderNumber: 0, status: "SENT" });
    });

    it("uses the company's saved reminder subject/body template, not the built-in fallback", async () => {
      await createEmailSettings(userA.id);
      await prisma.reminderSettings.create({
        data: { userId: userA.id, enabled: true, subjectTemplate: "Vlastný predmet {{invoiceNumber}}", bodyTemplate: "Vlastný text {{invoiceNumber}}" },
      });
      const invoice = await createInvoice(userA.id);

      const res = mockRes();
      await invoiceController.sendReminderNow(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(200);
      expect(receivedEmails[0].subject).toBe("Vlastný predmet 2026-0001");
      expect(receivedEmails[0].text?.trim()).toBe("Vlastný text 2026-0001");
    });

    it("never sends a manual reminder for a paid invoice — same guard as the automatic scheduler", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id);
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 10000 } }), mockRes());

      const res = mockRes();
      await invoiceController.sendReminderNow(mockReq(userA.id, { params: { id: invoice.id } }), res);

      expect(res.statusCode).toBe(400);
      expect(receivedEmails).toHaveLength(0);
    });

    it("refuses to send a reminder for a credit note", async () => {
      await createEmailSettings(userA.id);
      const creditNote = await createInvoice(userA.id, { documentType: "CREDIT_NOTE" });
      const res = mockRes();
      await invoiceController.sendReminderNow(mockReq(userA.id, { params: { id: creditNote.id } }), res);
      expect(res.statusCode).toBe(400);
      expect(receivedEmails).toHaveLength(0);
    });

    it("user A cannot trigger a reminder on user B's invoice", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.sendReminderNow(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);
      expect(receivedEmails).toHaveLength(0);
    });
  });

  describe("listSentEmails", () => {
    it("lists sent emails for an invoice, most recent first", async () => {
      await createEmailSettings(userA.id);
      const invoice = await createInvoice(userA.id);
      await invoiceController.sendInvoiceEmail(mockReq(userA.id, { params: { id: invoice.id } }), mockRes());

      const res = mockRes();
      await invoiceController.listSentEmails(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body as unknown[]).toHaveLength(1);
    });

    it("user A cannot list user B's sent emails", async () => {
      const invoice = await createInvoice(userB.id);
      const res = mockRes();
      await invoiceController.listSentEmails(mockReq(userA.id, { params: { id: invoice.id } }), res);
      expect(res.statusCode).toBe(404);
    });
  });
});
