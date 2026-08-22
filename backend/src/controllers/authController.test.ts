import type { Request, Response } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "../lib/prisma";
import { AUTH_COOKIE_NAME } from "../middleware/auth";
import { generateLinkToken, hashLinkToken } from "../lib/crypto";
import * as appSmtp from "../lib/appSmtp";
import * as authController from "./authController";

// getAppSmtpConfig reads from env.ts, which is parsed once at process startup — too early to
// point at a test SMTP server whose port is only known after it starts listening. Mocked at
// this one boundary only; the actual send below still goes through a real local SMTP server
// (same "verify empirically" approach as emailSender.test.ts/reminderScheduler.test.ts), so
// this proves the real send path, just not the env-parsing step (which is a one-line accessor —
// see appSmtp.ts).
vi.mock("../lib/appSmtp", () => ({ getAppSmtpConfig: vi.fn() }));

function extractToken(text: string): string {
  const match = text.match(/token=([0-9a-f]{64})/);
  if (!match) throw new Error(`no token found in email text: ${text}`);
  return match[1];
}

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
  describe("password reset & email verification (real local SMTP server)", () => {
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

      vi.mocked(appSmtp.getAppSmtpConfig).mockReturnValue({
        host: "127.0.0.1",
        port,
        secure: false,
        user: "test",
        password: "test",
        fromEmail: "noreply@example.com",
        fromName: "e-Faktúra Konvertor",
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Un-configure the mock so sibling describe blocks in this file (which call register()
      // too, but don't care about email at all) don't try sending through this now-closed
      // server — same "no APP_SMTP configured" default those tests were written against.
      vi.mocked(appSmtp.getAppSmtpConfig).mockReturnValue(null);
    });

    afterEach(() => {
      received = [];
    });

    describe("register — sends a verification email", () => {
      it("sends a real verification email with a working link and stores only the token's hash", async () => {
        const res = mockRes();
        await authController.register(mockReq({ body: { email: "verify-me@example.com", password: "password123" } }), res);
        expect(res.statusCode).toBe(201);
        expect(received).toHaveLength(1);
        expect(received[0].to && "value" in received[0].to ? received[0].to.value[0].address : undefined).toBe("verify-me@example.com");

        const user = await prisma.user.findUnique({ where: { email: "verify-me@example.com" } });
        expect(user?.emailVerified).toBe(false);

        const token = extractToken(received[0].text ?? "");
        const tokenRow = await prisma.emailVerificationToken.findFirst({ where: { userId: user!.id } });
        expect(tokenRow?.tokenHash).toBe(hashLinkToken(token));
      });

      it("still succeeds (just without an email) when APP_SMTP isn't configured — never blocks registration", async () => {
        vi.mocked(appSmtp.getAppSmtpConfig).mockReturnValueOnce(null);
        const res = mockRes();
        await authController.register(mockReq({ body: { email: "no-smtp-configured@example.com", password: "password123" } }), res);
        expect(res.statusCode).toBe(201);
        expect(received).toHaveLength(0);
      });
    });

    describe("requestPasswordReset", () => {
      it("responds identically whether or not the account exists (anti-enumeration)", async () => {
        await prisma.user.create({ data: { email: "has-account@example.com", passwordHash: "x" } });

        const existingRes = mockRes();
        await authController.requestPasswordReset(mockReq({ body: { email: "has-account@example.com" } }), existingRes);
        const missingRes = mockRes();
        await authController.requestPasswordReset(mockReq({ body: { email: "no-such-account@example.com" } }), missingRes);

        expect(existingRes.statusCode).toBe(missingRes.statusCode);
        expect(existingRes.body).toEqual(missingRes.body);
      });

      it("only actually sends an email when the account exists", async () => {
        await prisma.user.create({ data: { email: "real-account@example.com", passwordHash: "x" } });
        await authController.requestPasswordReset(mockReq({ body: { email: "real-account@example.com" } }), mockRes());
        expect(received).toHaveLength(1);

        received = [];
        await authController.requestPasswordReset(mockReq({ body: { email: "fake-account@example.com" } }), mockRes());
        expect(received).toHaveLength(0);
      });

      it("a fresh request invalidates an earlier unused token for the same user", async () => {
        await prisma.user.create({ data: { email: "double-request@example.com", passwordHash: "x" } });

        await authController.requestPasswordReset(mockReq({ body: { email: "double-request@example.com" } }), mockRes());
        const firstToken = extractToken(received[0].text ?? "");
        received = [];
        await authController.requestPasswordReset(mockReq({ body: { email: "double-request@example.com" } }), mockRes());
        const secondToken = extractToken(received[0].text ?? "");

        const oldRes = mockRes();
        await authController.resetPassword(mockReq({ body: { token: firstToken, newPassword: "whatever-123" } }), oldRes);
        expect(oldRes.statusCode).toBe(400);

        const newRes = mockRes();
        await authController.resetPassword(mockReq({ body: { token: secondToken, newPassword: "whatever-123" } }), newRes);
        expect(newRes.statusCode).toBe(200);
      });
    });

    describe("resetPassword", () => {
      it("changes the password, logs the user in, and the old password stops working", async () => {
        await authController.register(mockReq({ body: { email: "reset-flow@example.com", password: "old-password-123" } }), mockRes());
        received = [];
        await authController.requestPasswordReset(mockReq({ body: { email: "reset-flow@example.com" } }), mockRes());
        const token = extractToken(received[0].text ?? "");

        const res = mockRes();
        await authController.resetPassword(mockReq({ body: { token, newPassword: "new-password-456" } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.cookies).toHaveLength(1); // auto-login after a successful reset

        const loginWithOld = mockRes();
        await authController.login(mockReq({ body: { email: "reset-flow@example.com", password: "old-password-123" } }), loginWithOld);
        expect(loginWithOld.statusCode).toBe(401);

        const loginWithNew = mockRes();
        await authController.login(mockReq({ body: { email: "reset-flow@example.com", password: "new-password-456" } }), loginWithNew);
        expect(loginWithNew.statusCode).toBe(200);
      });

      it("rejects a nonexistent token with 400", async () => {
        const res = mockRes();
        await authController.resetPassword(mockReq({ body: { token: "not-a-real-token", newPassword: "whatever-123" } }), res);
        expect(res.statusCode).toBe(400);
      });

      it("rejects an expired token", async () => {
        const user = await prisma.user.create({ data: { email: "expired-token@example.com", passwordHash: "x" } });
        const token = generateLinkToken();
        await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() - 1000) },
        });
        const res = mockRes();
        await authController.resetPassword(mockReq({ body: { token, newPassword: "whatever-123" } }), res);
        expect(res.statusCode).toBe(400);
      });

      it("rejects a token that's already been used", async () => {
        const user = await prisma.user.create({ data: { email: "used-token@example.com", passwordHash: "x" } });
        const token = generateLinkToken();
        await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + 3_600_000), usedAt: new Date() },
        });
        const res = mockRes();
        await authController.resetPassword(mockReq({ body: { token, newPassword: "whatever-123" } }), res);
        expect(res.statusCode).toBe(400);
      });
    });

    describe("requestVerification / verifyEmail", () => {
      it("requestVerification sends an email for an unverified user", async () => {
        const user = await prisma.user.create({ data: { email: "resend-verify@example.com", passwordHash: "x" } });
        const res = mockRes();
        await authController.requestVerification(mockReq({ userId: user.id }), res);
        expect(res.statusCode).toBe(200);
        expect(received).toHaveLength(1);
      });

      it("requestVerification is a no-op (no email sent) once already verified", async () => {
        const user = await prisma.user.create({ data: { email: "already-verified@example.com", passwordHash: "x", emailVerified: true } });
        const res = mockRes();
        await authController.requestVerification(mockReq({ userId: user.id }), res);
        expect(res.statusCode).toBe(200);
        expect(received).toHaveLength(0);
      });

      it("verifyEmail marks the user verified given a valid token", async () => {
        const user = await prisma.user.create({ data: { email: "confirm-me@example.com", passwordHash: "x" } });
        await authController.requestVerification(mockReq({ userId: user.id }), mockRes());
        const token = extractToken(received[0].text ?? "");

        const res = mockRes();
        await authController.verifyEmail(mockReq({ body: { token } }), res);
        expect(res.statusCode).toBe(200);

        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        expect(updated?.emailVerified).toBe(true);
        expect(updated?.emailVerifiedAt).not.toBeNull();
      });

      it("rejects an invalid token with 400", async () => {
        const res = mockRes();
        await authController.verifyEmail(mockReq({ body: { token: "not-a-real-token" } }), res);
        expect(res.statusCode).toBe(400);
      });

      it("the same token can't be used twice", async () => {
        const user = await prisma.user.create({ data: { email: "double-verify@example.com", passwordHash: "x" } });
        await authController.requestVerification(mockReq({ userId: user.id }), mockRes());
        const token = extractToken(received[0].text ?? "");
        await authController.verifyEmail(mockReq({ body: { token } }), mockRes());

        const res = mockRes();
        await authController.verifyEmail(mockReq({ body: { token } }), res);
        expect(res.statusCode).toBe(400);
      });
    });
  });

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
