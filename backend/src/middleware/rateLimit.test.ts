import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { authRateLimiter } from "./rateLimit";

// express-rate-limit's default key generator reads req.ip and validates it strictly (v7+) —
// every test below uses its own IP so the shared authRateLimiter singleton's usage in one test
// never bleeds into another.
function mockReq(ip: string): Request {
  // express-rate-limit v8 validates trust-proxy settings via req.app.get(...) even when the
  // result doesn't matter for an IP-only test like this one — a bare mock without `.app` throws
  // inside that validation before the limiter logic itself even runs.
  return { ip, headers: {}, socket: { remoteAddress: ip }, app: { get: () => false } } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
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
    setHeader() {
      return res;
    },
    getHeader() {
      return undefined;
    },
    removeHeader() {
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("authRateLimiter", () => {
  it("allows requests up to the configured limit (10 per window)", async () => {
    const ip = "10.0.1.1";
    for (let i = 0; i < 10; i++) {
      const next = vi.fn();
      await authRateLimiter(mockReq(ip), mockRes(), next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("rejects the request past the limit with 429 and a Slovak message, without calling next()", async () => {
    const ip = "10.0.1.2";
    for (let i = 0; i < 10; i++) {
      await authRateLimiter(mockReq(ip), mockRes(), vi.fn() as unknown as NextFunction);
    }

    const res = mockRes();
    const next = vi.fn();
    await authRateLimiter(mockReq(ip), res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Príliš veľa pokusov, skús to znova o chvíľu." });
  });

  it("tracks each IP independently — one IP hitting its limit doesn't affect another", async () => {
    const exhaustedIp = "10.0.1.3";
    for (let i = 0; i < 10; i++) {
      await authRateLimiter(mockReq(exhaustedIp), mockRes(), vi.fn() as unknown as NextFunction);
    }
    const blockedRes = mockRes();
    await authRateLimiter(mockReq(exhaustedIp), blockedRes, vi.fn() as unknown as NextFunction);
    expect(blockedRes.statusCode).toBe(429);

    const freshIp = "10.0.1.4";
    const next = vi.fn();
    await authRateLimiter(mockReq(freshIp), mockRes(), next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});
