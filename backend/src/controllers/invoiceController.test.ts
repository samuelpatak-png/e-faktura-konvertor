import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import * as invoiceController from "./invoiceController";

function mockReq(userId: string, overrides: Partial<{ params: Record<string, string>; query: Record<string, string>; body: unknown }> = {}): Request {
  return { userId, params: {}, query: {}, body: {}, ...overrides } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
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
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

async function createUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

async function createInvoice(userId: string, overrides: Partial<{ number: string; dueDate: string; grossAmountCents: number }> = {}) {
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
      supplierIcDph: "SK1111111111",
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
    },
  });
}

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
    });

    it("refuses to cancel a fully paid invoice", async () => {
      const invoice = await createInvoice(userA.id, { grossAmountCents: 10000 });
      await invoiceController.recordPayment(mockReq(userA.id, { params: { id: invoice.id }, body: { amountCents: 10000 } }), mockRes());

      const res = mockRes();
      await invoiceController.cancelInvoice(mockReq(userA.id, { params: { id: invoice.id } }), res);
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
  });
});
