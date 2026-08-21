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

  const validEmailSettingsBody = {
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "faktury@mojafirma.sk",
    smtpPassword: "app-password-123",
    fromEmail: "faktury@mojafirma.sk",
    fromName: "Moja Firma s.r.o.",
    subjectTemplate: "Faktúra {{invoiceNumber}}",
    bodyTemplate: "Text {{invoiceNumber}}",
  };

  describe("getEmailSettings / saveEmailSettings / deleteEmailSettings", () => {
    it("returns configured: false when nothing is saved yet", async () => {
      const res = mockRes();
      await companyController.getEmailSettings(mockReq(userA.id), res);
      expect(res.body).toEqual({ configured: false });
    });

    it("saves SMTP settings and never returns the password (plaintext or encrypted) back", async () => {
      const res = mockRes();
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), res);
      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.configured).toBe(true);
      expect(body.smtpHost).toBe("smtp.example.com");
      expect(body).not.toHaveProperty("smtpPassword");
      expect(body).not.toHaveProperty("encryptedSmtpPassword");
    });

    it("encrypts the password at rest — the raw DB row never contains the plaintext", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      const row = await prisma.emailSettings.findUnique({ where: { userId: userA.id } });
      expect(row?.encryptedSmtpPassword).not.toContain("app-password-123");
    });

    it("rejects invalid input (bad fromEmail) with 400", async () => {
      const res = mockRes();
      await companyController.saveEmailSettings(mockReq(userA.id, { body: { ...validEmailSettingsBody, fromEmail: "not-an-email" } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("getEmailSettings reflects a subsequent save via GET", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      const res = mockRes();
      await companyController.getEmailSettings(mockReq(userA.id), res);
      expect((res.body as { configured: boolean }).configured).toBe(true);
    });

    it("deleteEmailSettings removes the row", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      await companyController.deleteEmailSettings(mockReq(userA.id), mockRes());
      const res = mockRes();
      await companyController.getEmailSettings(mockReq(userA.id), res);
      expect(res.body).toEqual({ configured: false });
    });

    it("user A's email settings never leak into user B's GET", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      const res = mockRes();
      await companyController.getEmailSettings(mockReq(userB.id), res);
      expect(res.body).toEqual({ configured: false });
    });

    it("rejects the very first save with an empty SMTP password — there is nothing existing to fall back to", async () => {
      const res = mockRes();
      await companyController.saveEmailSettings(mockReq(userA.id, { body: { ...validEmailSettingsBody, smtpPassword: "" } }), res);
      expect(res.statusCode).toBe(400);
      expect(await prisma.emailSettings.findUnique({ where: { userId: userA.id } })).toBeNull();
    });

    it("re-saving with an empty password keeps the previously-encrypted password unchanged, so editing only the template doesn't require re-entering it", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      const before = await prisma.emailSettings.findUnique({ where: { userId: userA.id } });

      const res = mockRes();
      await companyController.saveEmailSettings(
        mockReq(userA.id, { body: { ...validEmailSettingsBody, smtpPassword: "", subjectTemplate: "Nový predmet {{invoiceNumber}}" } }),
        res
      );
      expect(res.statusCode).toBe(200);

      const after = await prisma.emailSettings.findUnique({ where: { userId: userA.id } });
      expect(after?.encryptedSmtpPassword).toBe(before?.encryptedSmtpPassword);
      expect(after?.subjectTemplate).toBe("Nový predmet {{invoiceNumber}}");
    });

    it("re-saving with a new password re-encrypts it, replacing the old ciphertext", async () => {
      await companyController.saveEmailSettings(mockReq(userA.id, { body: validEmailSettingsBody }), mockRes());
      const before = await prisma.emailSettings.findUnique({ where: { userId: userA.id } });

      await companyController.saveEmailSettings(mockReq(userA.id, { body: { ...validEmailSettingsBody, smtpPassword: "new-password-456" } }), mockRes());
      const after = await prisma.emailSettings.findUnique({ where: { userId: userA.id } });

      expect(after?.encryptedSmtpPassword).not.toBe(before?.encryptedSmtpPassword);
      expect(after?.encryptedSmtpPassword).not.toContain("new-password-456");
    });
  });

  const validReminderSettingsBody = {
    enabled: true,
    firstReminderDays: 7,
    reminderCount: 3,
    intervalDays: 7,
    subjectTemplate: "Upomienka {{invoiceNumber}}",
    bodyTemplate: "Text {{invoiceNumber}}",
  };

  describe("getReminderSettings / saveReminderSettings", () => {
    it("returns null when nothing is saved yet", async () => {
      const res = mockRes();
      await companyController.getReminderSettings(mockReq(userA.id), res);
      expect(res.body).toBeNull();
    });

    it("saves and returns the reminder cadence config", async () => {
      const res = mockRes();
      await companyController.saveReminderSettings(mockReq(userA.id, { body: validReminderSettingsBody }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ enabled: true, firstReminderDays: 7, reminderCount: 3, intervalDays: 7 });
    });

    it("upserts on a second save instead of erroring", async () => {
      await companyController.saveReminderSettings(mockReq(userA.id, { body: validReminderSettingsBody }), mockRes());
      const res = mockRes();
      await companyController.saveReminderSettings(mockReq(userA.id, { body: { ...validReminderSettingsBody, reminderCount: 5 } }), res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { reminderCount: number }).reminderCount).toBe(5);
    });

    it("rejects a zero reminderCount with 400", async () => {
      const res = mockRes();
      await companyController.saveReminderSettings(mockReq(userA.id, { body: { ...validReminderSettingsBody, reminderCount: 0 } }), res);
      expect(res.statusCode).toBe(400);
    });

    it("user A's reminder settings never leak into user B's GET", async () => {
      await companyController.saveReminderSettings(mockReq(userA.id, { body: validReminderSettingsBody }), mockRes());
      const res = mockRes();
      await companyController.getReminderSettings(mockReq(userB.id), res);
      expect(res.body).toBeNull();
    });
  });
});
