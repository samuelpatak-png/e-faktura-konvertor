import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import * as partnerController from "./partnerController";

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

const VALID_PARTNER = {
  name: "Zákazník s.r.o.",
  ico: "12345678",
  dic: "1234567890",
  icDph: "SK1234567890",
  street: "Hlavná 1",
  city: "Bratislava",
  postalCode: "81101",
  countryCode: "SK",
  peppolScheme: null,
  peppolId: null,
  email: "faktury@zakaznik.sk",
  note: null,
  category: null,
};

async function createUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

describe("partnerController", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createUser("a@example.com");
    userB = await createUser("b@example.com");
  });

  it("creates a partner scoped to the authenticated user", async () => {
    const res = mockRes();
    await partnerController.createPartner(mockReq(userA.id, { body: VALID_PARTNER }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { id: string; name: string };
    expect(body.name).toBe("Zákazník s.r.o.");

    const stored = await prisma.partner.findUnique({ where: { id: body.id } });
    expect(stored?.userId).toBe(userA.id);
  });

  it("rejects invalid input (missing required dic)", async () => {
    const res = mockRes();
    const { dic: _dic, ...withoutDic } = VALID_PARTNER;
    await partnerController.createPartner(mockReq(userA.id, { body: withoutDic }), res);
    expect(res.statusCode).toBe(400);
  });

  describe("multi-tenant isolation", () => {
    it("user A cannot see user B's partners in the list", async () => {
      await partnerController.createPartner(mockReq(userA.id, { body: VALID_PARTNER }), mockRes());
      await partnerController.createPartner(mockReq(userB.id, { body: { ...VALID_PARTNER, name: "Firma B" } }), mockRes());

      const res = mockRes();
      await partnerController.listPartners(mockReq(userA.id), res);
      const body = res.body as { items: { name: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items.map((p) => p.name)).toEqual(["Zákazník s.r.o."]);
    });

    it("user A gets 404 fetching user B's partner by id", async () => {
      const createRes = mockRes();
      await partnerController.createPartner(mockReq(userB.id, { body: VALID_PARTNER }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await partnerController.getPartner(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("user A cannot update user B's partner (and B's data is unchanged)", async () => {
      const createRes = mockRes();
      await partnerController.createPartner(mockReq(userB.id, { body: VALID_PARTNER }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await partnerController.updatePartner(
        mockReq(userA.id, { params: { id: bId }, body: { ...VALID_PARTNER, name: "Hacknuté meno", isActive: true } }),
        res
      );
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.partner.findUnique({ where: { id: bId } });
      expect(stillB?.name).toBe("Zákazník s.r.o.");
    });

    it("user A cannot soft-delete user B's partner", async () => {
      const createRes = mockRes();
      await partnerController.createPartner(mockReq(userB.id, { body: VALID_PARTNER }), createRes);
      const bId = (createRes.body as { id: string }).id;

      const res = mockRes();
      await partnerController.deletePartner(mockReq(userA.id, { params: { id: bId } }), res);
      expect(res.statusCode).toBe(404);

      const stillB = await prisma.partner.findUnique({ where: { id: bId } });
      expect(stillB?.isActive).toBe(true);
    });
  });

  describe("soft delete", () => {
    it("deactivates instead of removing the row, and excludes it from the default list", async () => {
      const createRes = mockRes();
      await partnerController.createPartner(mockReq(userA.id, { body: VALID_PARTNER }), createRes);
      const id = (createRes.body as { id: string }).id;

      const delRes = mockRes();
      await partnerController.deletePartner(mockReq(userA.id, { params: { id } }), delRes);
      expect(delRes.statusCode).toBe(204);

      const stored = await prisma.partner.findUnique({ where: { id } });
      expect(stored).not.toBeNull();
      expect(stored?.isActive).toBe(false);

      const defaultList = mockRes();
      await partnerController.listPartners(mockReq(userA.id), defaultList);
      expect((defaultList.body as { total: number }).total).toBe(0);

      const withInactive = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { includeInactive: "true" } }), withInactive);
      expect((withInactive.body as { total: number }).total).toBe(1);
    });
  });

  describe("exact dic filter (used by the invoice form's 'already in registry?' check)", () => {
    it("finds a partner by exact dic even though it wouldn't match the name/ico fulltext search", async () => {
      await partnerController.createPartner(mockReq(userA.id, { body: { ...VALID_PARTNER, name: "Alfa s.r.o.", dic: "9999999999" } }), mockRes());

      // Regression: q searches only name/ico, so passing a DIČ as `q` must NOT find it —
      // this is exactly the bug the dedicated `dic` param exists to avoid.
      const byQ = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { q: "9999999999" } }), byQ);
      expect((byQ.body as { total: number }).total).toBe(0);

      const byDic = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { dic: "9999999999" } }), byDic);
      expect((byDic.body as { total: number }).total).toBe(1);
    });

    it("still finds a deactivated partner by dic when includeInactive is set", async () => {
      const createRes = mockRes();
      await partnerController.createPartner(mockReq(userA.id, { body: VALID_PARTNER }), createRes);
      const id = (createRes.body as { id: string }).id;
      await partnerController.deletePartner(mockReq(userA.id, { params: { id } }), mockRes());

      const res = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { dic: VALID_PARTNER.dic, includeInactive: "true" } }), res);
      expect((res.body as { total: number }).total).toBe(1);
    });
  });

  describe("search", () => {
    it("filters the list by name or ico substring", async () => {
      await partnerController.createPartner(mockReq(userA.id, { body: { ...VALID_PARTNER, name: "Alfa s.r.o.", ico: "11111111" } }), mockRes());
      await partnerController.createPartner(mockReq(userA.id, { body: { ...VALID_PARTNER, name: "Beta s.r.o.", ico: "22222222" } }), mockRes());

      const byName = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { q: "Alfa" } }), byName);
      expect((byName.body as { items: { name: string }[] }).items.map((p) => p.name)).toEqual(["Alfa s.r.o."]);

      const byIco = mockRes();
      await partnerController.listPartners(mockReq(userA.id, { query: { q: "22222222" } }), byIco);
      expect((byIco.body as { items: { name: string }[] }).items.map((p) => p.name)).toEqual(["Beta s.r.o."]);
    });
  });
});
