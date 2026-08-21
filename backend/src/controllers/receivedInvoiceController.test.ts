import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import * as receivedInvoiceController from "./receivedInvoiceController";

const fixturesDir = join(__dirname, "../../test/fixtures");
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

function mockReq(
  userId: string,
  overrides: Partial<{ params: Record<string, string>; body: unknown; file: { buffer: Buffer; originalname: string } }> = {}
): Request {
  return { userId, params: {}, body: {}, ...overrides } as unknown as Request;
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

function fileFrom(xml: string, name = "faktura.xml") {
  return { buffer: Buffer.from(xml, "utf8"), originalname: name };
}

describe("receivedInvoiceController", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createUser("a@example.com");
    userB = await createUser("b@example.com");
  });

  describe("uploadReceivedInvoice", () => {
    it("parses and stores a valid uploaded invoice", async () => {
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(
        mockReq(userA.id, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }),
        res
      );
      expect(res.statusCode).toBe(201);
      const body = res.body as { documentType: string; number: string; grossAmountCents: number; ourErrors: string[] };
      expect(body.documentType).toBe("INVOICE");
      expect(body.number).toBeTruthy();
      expect(body.grossAmountCents).toBeGreaterThan(0);
      expect(body.ourErrors).toEqual([]);
    }, 15000);

    it("rejects with 400 (not a 500 crash) when no file is attached", async () => {
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id), res);
      expect(res.statusCode).toBe(400);
    });

    it("rejects malformed XML with a clear 400, not a crash", async () => {
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom("not xml at all") }), res);
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toBeTruthy();
    });

    it("rejects an XXE payload with a clear 400, never leaking file content", async () => {
      const xxe = `<?xml version="1.0"?>
<!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<Invoice><cbc:ID>&xxe;</cbc:ID></Invoice>`;
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(xxe) }), res);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/root:.*:0:0:/);
    });

    it("stores the raw uploaded XML verbatim so it can be re-downloaded later", async () => {
      const xml = loadFixture("credit-note.xml");
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(xml, "dobropis.xml") }), res);
      const id = (res.body as { id: string }).id;
      const stored = await prisma.receivedInvoice.findUnique({ where: { id } });
      expect(stored?.rawXml).toBe(xml);
      expect(stored?.documentType).toBe("CREDIT_NOTE");
    }, 15000);
  });

  describe("multi-tenant isolation", () => {
    async function uploadAsUser(userId: string) {
      const res = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userId, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }), res);
      return (res.body as { id: string }).id;
    }

    it("user A cannot see user B's received invoices in the list", async () => {
      await uploadAsUser(userA.id);
      await uploadAsUser(userB.id);
      const res = mockRes();
      await receivedInvoiceController.listReceivedInvoices(mockReq(userA.id), res);
      expect((res.body as unknown[]).length).toBe(1);
    }, 15000);

    it("user A gets 404 fetching user B's received invoice", async () => {
      const bId = await uploadAsUser(userB.id);
      const res = mockRes();
      await receivedInvoiceController.getReceivedInvoice(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);
    }, 15000);

    it("user A cannot record a payment on user B's received invoice", async () => {
      const bId = await uploadAsUser(userB.id);
      const res = mockRes();
      await receivedInvoiceController.recordReceivedInvoicePayment(mockReq(userA.id, { params: { id: bId }, body: { amountCents: 100 } }), res);
      expect(res.statusCode).toBe(404);
    }, 15000);

    it("user A cannot delete user B's received invoice", async () => {
      const bId = await uploadAsUser(userB.id);
      const res = mockRes();
      await receivedInvoiceController.deleteReceivedInvoice(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);
      expect(await prisma.receivedInvoice.findUnique({ where: { id: bId } })).not.toBeNull();
    }, 15000);
  });

  describe("recordReceivedInvoicePayment", () => {
    it("records a partial payment and derives PARTIALLY_PAID", async () => {
      const uploadRes = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }), uploadRes);
      const id = (uploadRes.body as { id: string; grossAmountCents: number }).id;

      const res = mockRes();
      await receivedInvoiceController.recordReceivedInvoicePayment(mockReq(userA.id, { params: { id }, body: { amountCents: 1 } }), res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { paymentStatus: string }).paymentStatus).toBe("PARTIALLY_PAID");
    }, 15000);

    it("rejects a payment that would overpay the received invoice", async () => {
      const uploadRes = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }), uploadRes);
      const body = uploadRes.body as { id: string; grossAmountCents: number };

      const res = mockRes();
      await receivedInvoiceController.recordReceivedInvoicePayment(
        mockReq(userA.id, { params: { id: body.id }, body: { amountCents: body.grossAmountCents + 1 } }),
        res
      );
      expect(res.statusCode).toBe(400);
    }, 15000);

    // Regression: a received CREDIT_NOTE isn't a receivable we can record a payment against —
    // this guard didn't exist at all before (only the outgoing side had it).
    it("rejects a payment on a received credit note with 400", async () => {
      const uploadRes = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(loadFixture("credit-note.xml")) }), uploadRes);
      const id = (uploadRes.body as { id: string; documentType: string }).id;
      expect((uploadRes.body as { documentType: string }).documentType).toBe("CREDIT_NOTE");

      const res = mockRes();
      await receivedInvoiceController.recordReceivedInvoicePayment(mockReq(userA.id, { params: { id }, body: { amountCents: 1 } }), res);
      expect(res.statusCode).toBe(400);
    }, 15000);

    it("two concurrent payments racing for the last of the balance don't both succeed and overshoot the total", async () => {
      const uploadRes = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }), uploadRes);
      const body = uploadRes.body as { id: string; grossAmountCents: number };
      const half = Math.ceil(body.grossAmountCents / 2);

      const resA = mockRes();
      const resB = mockRes();
      await Promise.all([
        receivedInvoiceController.recordReceivedInvoicePayment(mockReq(userA.id, { params: { id: body.id }, body: { amountCents: half } }), resA),
        receivedInvoiceController.recordReceivedInvoicePayment(mockReq(userA.id, { params: { id: body.id }, body: { amountCents: half } }), resB),
      ]);

      const paid = await prisma.receivedInvoice.findUnique({ where: { id: body.id } });
      expect(paid?.paidAmountCents).toBeLessThanOrEqual(body.grossAmountCents);
    }, 15000);
  });

  describe("deleteReceivedInvoice", () => {
    it("permanently removes the row (uploads are the user's own mistake to undo, not a shared record)", async () => {
      const uploadRes = mockRes();
      await receivedInvoiceController.uploadReceivedInvoice(mockReq(userA.id, { file: fileFrom(loadFixture("domestic-23-standard.xml")) }), uploadRes);
      const id = (uploadRes.body as { id: string }).id;

      const res = mockRes();
      await receivedInvoiceController.deleteReceivedInvoice(mockReq(userA.id, { params: { id } }), res);
      expect(res.statusCode).toBe(204);
      expect(await prisma.receivedInvoice.findUnique({ where: { id } })).toBeNull();
    }, 15000);
  });
});
