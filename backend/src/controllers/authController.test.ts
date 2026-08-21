import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { AUTH_COOKIE_NAME } from "../middleware/auth";
import * as authController from "./authController";

function mockReq(overrides: Partial<{ userId: string; params: Record<string, string>; body: unknown }> = {}): Request {
  return { params: {}, body: {}, ...overrides } as unknown as Request;
}

interface CookieCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}
interface ClearCookieCall {
  name: string;
  options: Record<string, unknown>;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as CookieCall[],
    clearedCookies: [] as ClearCookieCall[],
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
    cookie(name: string, value: string, options: Record<string, unknown>) {
      res.cookies.push({ name, value, options });
      return res;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      res.clearedCookies.push({ name, options });
      return res;
    },
  };
  return res as unknown as Response & typeof res;
}

async function createUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("authController", () => {
  describe("logout — cookie clearing", () => {
    // Regression: clearCookie must be called with the SAME path/secure/sameSite/httpOnly
    // options the cookie was originally set with — a browser only deletes a cookie when those
    // attributes match. The old logout only passed `{ path: "/" }`, so `secure`/`sameSite`/
    // `httpOnly` came back undefined instead of the real values setAuthCookie used, and the
    // cookie was never actually cleared in a real browser.
    it("clears the cookie with the exact same options register's setAuthCookie used to set it", async () => {
      const registerRes = mockRes();
      await authController.register(mockReq({ body: { email: "cookie-test@example.com", password: "password123" } }), registerRes);
      expect(registerRes.cookies).toHaveLength(1);
      expect(registerRes.cookies[0].name).toBe(AUTH_COOKIE_NAME);
      const setOptions = registerRes.cookies[0].options;

      const logoutRes = mockRes();
      authController.logout(mockReq(), logoutRes);
      expect(logoutRes.clearedCookies).toHaveLength(1);
      const clearOptions = logoutRes.clearedCookies[0].options;

      expect(clearOptions.path).toBe(setOptions.path);
      expect(clearOptions.secure).toBe(setOptions.secure);
      expect(clearOptions.sameSite).toBe(setOptions.sameSite);
      expect(clearOptions.httpOnly).toBe(setOptions.httpOnly);
    });

    it("clears the cookie with the exact same options login's setAuthCookie used to set it", async () => {
      await authController.register(mockReq({ body: { email: "cookie-test-2@example.com", password: "password123" } }), mockRes());
      const loginRes = mockRes();
      await authController.login(mockReq({ body: { email: "cookie-test-2@example.com", password: "password123" } }), loginRes);
      const setOptions = loginRes.cookies[0].options;

      const logoutRes = mockRes();
      authController.logout(mockReq(), logoutRes);
      const clearOptions = logoutRes.clearedCookies[0].options;
      // Compared field-by-field, not a full toEqual — setAuthCookie's options also carry
      // maxAge, which clearCookie deliberately never sets (it clears via an expired date
      // instead), so a whole-object comparison would never pass either way.
      expect(clearOptions.path).toBe(setOptions.path);
      expect(clearOptions.secure).toBe(setOptions.secure);
      expect(clearOptions.sameSite).toBe(setOptions.sameSite);
      expect(clearOptions.httpOnly).toBe(setOptions.httpOnly);
    });
  });

  describe("me — never returns branding blobs", () => {
    it("returns companyProfile: null when the user has no profile yet", async () => {
      const user = await createUser("no-profile@example.com");
      const res = mockRes();
      await authController.me(mockReq({ userId: user.id }), res);
      expect((res.body as { companyProfile: unknown }).companyProfile).toBeNull();
    });

    // Regression: /auth/me used `select: { companyProfile: true }` with no nested select,
    // which pulls every scalar column including logoData/stampData/signatureData — multi-MB
    // base64 strings re-downloaded on every page-load refresh.
    it("strips logoData/stampData/signatureData from the embedded companyProfile, same DTO as GET /company/profile", async () => {
      const user = await createUser("with-branding@example.com");
      await prisma.companyProfile.create({
        data: {
          userId: user.id,
          name: "Firma s.r.o.",
          ico: "11111111",
          dic: "1111111111",
          icDph: "SK1111111111",
          street: "Ulica 1",
          city: "Bratislava",
          postalCode: "81101",
          country: "SK",
          iban: "SK9711000000002612345678",
          logoData: TINY_PNG.toString("base64"),
          logoMimeType: "image/png",
        },
      });

      const res = mockRes();
      await authController.me(mockReq({ userId: user.id }), res);
      const companyProfile = (res.body as { companyProfile: Record<string, unknown> }).companyProfile;
      expect(companyProfile.logoData).toBeUndefined();
      expect(companyProfile.stampData).toBeUndefined();
      expect(companyProfile.signatureData).toBeUndefined();
      // The DTO still exposes booleans for whether each asset is set, same as GET /company/profile.
      expect(companyProfile.logo).toBe(true);
      expect(companyProfile.stamp).toBe(false);
      expect(companyProfile.name).toBe("Firma s.r.o.");
    });
  });
});
