import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import * as companyController from "./companyController";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function mockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "logo",
    originalname: "logo.png",
    encoding: "7bit",
    mimetype: "image/png",
    buffer: TINY_PNG,
    size: TINY_PNG.length,
    ...overrides,
  } as Express.Multer.File;
}

function mockReq(
  userId: string,
  overrides: Partial<{ params: Record<string, string>; body: unknown; files: Record<string, Express.Multer.File[]> }> = {}
): Request {
  return { userId, params: {}, body: {}, ...overrides } as unknown as Request;
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

async function createCompanyProfile(userId: string) {
  return prisma.companyProfile.create({
    data: {
      userId,
      name: "Dodávateľ s.r.o.",
      ico: "11111111",
      dic: "1111111111",
      icDph: "SK1111111111",
      street: "Ulica 1",
      city: "Bratislava",
      postalCode: "81101",
      country: "SK",
      iban: "SK9711000000002612345678",
    },
  });
}

describe("companyController", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createUser("a@example.com");
    userB = await createUser("b@example.com");
  });

  describe("getCompanyProfile", () => {
    it("returns null when the user has no profile yet", async () => {
      const res = mockRes();
      await companyController.getCompanyProfile(mockReq(userA.id), res);
      expect(res.body).toBeNull();
    });

    it("strips the base64 blobs and merges branding booleans instead", async () => {
      await createCompanyProfile(userA.id);
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile()] } }), mockRes());

      const res = mockRes();
      await companyController.getCompanyProfile(mockReq(userA.id), res);
      const body = res.body as Record<string, unknown>;
      expect(body.logoData).toBeUndefined();
      expect(body.logo).toBe(true);
      expect(body.stamp).toBe(false);
      expect(body.signature).toBe(false);
    });
  });

  describe("updateBranding", () => {
    it("uploads a single asset and flips its boolean flag on", async () => {
      await createCompanyProfile(userA.id);
      const res = mockRes();
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile()] } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ logo: true, stamp: false, signature: false });
    });

    it("uploads multiple assets in one request", async () => {
      await createCompanyProfile(userA.id);
      const res = mockRes();
      await companyController.updateBranding(
        mockReq(userA.id, {
          files: {
            logo: [mockFile({ fieldname: "logo" })],
            stamp: [mockFile({ fieldname: "stamp" })],
          },
        }),
        res
      );
      expect(res.body).toEqual({ logo: true, stamp: true, signature: false });
    });

    it("rejects when no file is present in the request", async () => {
      await createCompanyProfile(userA.id);
      const res = mockRes();
      await companyController.updateBranding(mockReq(userA.id, { files: {} }), res);
      expect(res.statusCode).toBe(400);
    });

    it("returns a clear 400 (not a raw crash) when the user has no CompanyProfile yet", async () => {
      const res = mockRes();
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile()] } }), res);
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toMatch(/Najprv vyplň/);
    });

    it("replacing an asset overwrites the previous image", async () => {
      await createCompanyProfile(userA.id);
      await companyController.updateBranding(
        mockReq(userA.id, { files: { logo: [mockFile({ buffer: TINY_PNG })] } }),
        mockRes()
      );
      const secondPng = Buffer.concat([TINY_PNG, Buffer.from([0])]);
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile({ buffer: secondPng })] } }), mockRes());

      const res = mockRes();
      await companyController.getBrandingAsset(mockReq(userA.id, { params: { asset: "logo" } }), res);
      expect(res.body).toEqual(secondPng);
    });
  });

  describe("removeBrandingAsset", () => {
    it("clears a previously-uploaded asset", async () => {
      await createCompanyProfile(userA.id);
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile()] } }), mockRes());

      const res = mockRes();
      await companyController.removeBrandingAsset(mockReq(userA.id, { params: { asset: "logo" } }), res);
      expect(res.body).toEqual({ logo: false, stamp: false, signature: false });
    });

    it("rejects an unknown asset name", async () => {
      await createCompanyProfile(userA.id);
      const res = mockRes();
      await companyController.removeBrandingAsset(mockReq(userA.id, { params: { asset: "watermark" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("returns a clear 400 when the user has no CompanyProfile yet", async () => {
      const res = mockRes();
      await companyController.removeBrandingAsset(mockReq(userA.id, { params: { asset: "logo" } }), res);
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toMatch(/Najprv vyplň/);
    });
  });

  describe("getBrandingAsset", () => {
    it("serves the raw bytes with the correct Content-Type", async () => {
      await createCompanyProfile(userA.id);
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile({ mimetype: "image/png" })] } }), mockRes());

      const res = mockRes();
      await companyController.getBrandingAsset(mockReq(userA.id, { params: { asset: "logo" } }), res);
      expect(res.headers["Content-Type"]).toBe("image/png");
      expect(res.body).toEqual(TINY_PNG);
    });

    it("404s when the asset was never uploaded", async () => {
      await createCompanyProfile(userA.id);
      const res = mockRes();
      await companyController.getBrandingAsset(mockReq(userA.id, { params: { asset: "stamp" } }), res);
      expect(res.statusCode).toBe(404);
    });

    it("rejects an unknown asset name with 400", async () => {
      const res = mockRes();
      await companyController.getBrandingAsset(mockReq(userA.id, { params: { asset: "watermark" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("user A's uploaded logo is never served back for user B's request", async () => {
      await createCompanyProfile(userA.id);
      await companyController.updateBranding(mockReq(userA.id, { files: { logo: [mockFile()] } }), mockRes());

      const res = mockRes();
      await companyController.getBrandingAsset(mockReq(userB.id, { params: { asset: "logo" } }), res);
      expect(res.statusCode).toBe(404);
    });
  });
});
