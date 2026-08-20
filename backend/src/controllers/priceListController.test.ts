import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import * as priceListController from "./priceListController";

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

const VALID_ITEM = {
  name: "Konzultačná hodina",
  description: "Vývoj softvéru",
  unitCode: "HUR",
  unitPrice: 45.5,
  vatRate: 23 as const,
  sku: "CONSULT-1",
};

async function createUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

describe("priceListController", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createUser("a@example.com");
    userB = await createUser("b@example.com");
  });

  it("creates an item, converting the euro unitPrice to unitPriceCents", async () => {
    const res = mockRes();
    await priceListController.createPriceListItem(mockReq(userA.id, { body: VALID_ITEM }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { id: string; unitPrice: number };
    expect(body.unitPrice).toBe(45.5);

    const stored = await prisma.priceListItem.findUnique({ where: { id: body.id } });
    expect(stored?.unitPriceCents).toBe(4550);
    expect(stored?.userId).toBe(userA.id);
  });

  it("rejects an invalid unit code", async () => {
    const res = mockRes();
    await priceListController.createPriceListItem(mockReq(userA.id, { body: { ...VALID_ITEM, unitCode: "NOT_A_REAL_CODE" } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unsupported VAT rate", async () => {
    const res = mockRes();
    await priceListController.createPriceListItem(mockReq(userA.id, { body: { ...VALID_ITEM, vatRate: 21 } }), res);
    expect(res.statusCode).toBe(400);
  });

  describe("multi-tenant isolation", () => {
    it("user A cannot see user B's price list items", async () => {
      await priceListController.createPriceListItem(mockReq(userA.id, { body: VALID_ITEM }), mockRes());
      await priceListController.createPriceListItem(mockReq(userB.id, { body: { ...VALID_ITEM, name: "Firma B item" } }), mockRes());

      const res = mockRes();
      await priceListController.listPriceListItems(mockReq(userA.id), res);
      const body = res.body as { items: { name: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items.map((i) => i.name)).toEqual(["Konzultačná hodina"]);
    });

    it("user A gets 404 fetching user B's item by id", async () => {
      const createRes = mockRes();
      await priceListController.createPriceListItem(mockReq(userB.id, { body: VALID_ITEM }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await priceListController.getPriceListItem(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("user A cannot update user B's item (and B's data is unchanged)", async () => {
      const createRes = mockRes();
      await priceListController.createPriceListItem(mockReq(userB.id, { body: VALID_ITEM }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await priceListController.updatePriceListItem(
        mockReq(userA.id, { params: { id: bId }, body: { ...VALID_ITEM, name: "Hacknuté", isActive: true } }),
        res
      );
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.priceListItem.findUnique({ where: { id: bId } });
      expect(stillB?.name).toBe("Konzultačná hodina");
    });

    it("user A cannot soft-delete user B's item", async () => {
      const createRes = mockRes();
      await priceListController.createPriceListItem(mockReq(userB.id, { body: VALID_ITEM }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await priceListController.deletePriceListItem(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.priceListItem.findUnique({ where: { id: bId } });
      expect(stillB?.isActive).toBe(true);
    });
  });

  describe("soft delete", () => {
    it("deactivates instead of removing the row, excluded from the default list", async () => {
      const createRes = mockRes();
      await priceListController.createPriceListItem(mockReq(userA.id, { body: VALID_ITEM }), createRes);
      const id = (createRes.body as { id: string }).id;

      const delRes = mockRes();
      await priceListController.deletePriceListItem(mockReq(userA.id, { params: { id } }), delRes);
      expect(delRes.statusCode).toBe(204);

      const defaultList = mockRes();
      await priceListController.listPriceListItems(mockReq(userA.id), defaultList);
      expect((defaultList.body as { total: number }).total).toBe(0);

      const withInactive = mockRes();
      await priceListController.listPriceListItems(mockReq(userA.id, { query: { includeInactive: "true" } }), withInactive);
      expect((withInactive.body as { total: number }).total).toBe(1);
    });
  });

  describe("search", () => {
    it("filters the list by name or sku substring", async () => {
      await priceListController.createPriceListItem(mockReq(userA.id, { body: { ...VALID_ITEM, name: "Webdizajn", sku: "WEB-1" } }), mockRes());
      await priceListController.createPriceListItem(mockReq(userA.id, { body: { ...VALID_ITEM, name: "Hosting", sku: "HOST-1" } }), mockRes());

      const byName = mockRes();
      await priceListController.listPriceListItems(mockReq(userA.id, { query: { q: "Webdizajn" } }), byName);
      expect((byName.body as { items: { name: string }[] }).items.map((i) => i.name)).toEqual(["Webdizajn"]);

      const bySku = mockRes();
      await priceListController.listPriceListItems(mockReq(userA.id, { query: { q: "HOST-1" } }), bySku);
      expect((bySku.body as { items: { name: string }[] }).items.map((i) => i.name)).toEqual(["Hosting"]);
    });
  });
});
