import type { Request, Response, NextFunction } from "express";
import multer from "multer";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Multer aborts an oversized upload by calling next(err) with a MulterError rather than
  // resolving req.file — without this, an oversized PDF/XML/branding upload (pdf.routes.ts,
  // receivedInvoice.routes.ts, company.routes.ts each configure their own limit — 10MB/5MB/2MB)
  // fell through to the generic 500 below instead of a clear, actionable message.
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Súbor je príliš veľký." });
  }
  console.error(err);
  res.status(500).json({ error: "Nastala neočakávaná chyba na serveri" });
}

export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
