import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./errorHandler";

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
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("errorHandler", () => {
  // Regression: an oversized PDF/XML/branding upload previously fell through to the generic
  // 500 below — multer surfaces it as a MulterError with code LIMIT_FILE_SIZE via next(err),
  // not by leaving req.file undefined.
  it("responds 413 with a clear Slovak message for a multer file-size-limit error", () => {
    const err = new multer.MulterError("LIMIT_FILE_SIZE");
    const res = mockRes();
    errorHandler(err, {} as Request, res, vi.fn() as unknown as NextFunction);
    expect(res.statusCode).toBe(413);
    expect((res.body as { error: string }).error).toMatch(/veľký/);
  });

  it("still responds 500 with the generic message for an ordinary error", () => {
    const res = mockRes();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(new Error("some internal detail"), {} as Request, res, vi.fn() as unknown as NextFunction);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toBe("Nastala neočakávaná chyba na serveri");
    consoleSpy.mockRestore();
  });

  it("responds 500 (not 413) for a different multer error code, e.g. an unexpected field", () => {
    const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE");
    const res = mockRes();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(err, {} as Request, res, vi.fn() as unknown as NextFunction);
    expect(res.statusCode).toBe(500);
    consoleSpy.mockRestore();
  });
});
