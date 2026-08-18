import type { Request, Response } from "express";
import { extractTextFromPdf, parseInvoiceText } from "../services/pdfParser";

export async function parsePdf(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, error: "Chýba súbor (pole 'file')" });
  }
  if (file.mimetype !== "application/pdf") {
    return res.status(400).json({ success: false, error: "Súbor musí byť vo formáte PDF" });
  }

  try {
    const text = await extractTextFromPdf(file.buffer);
    const extracted = parseInvoiceText(text);
    res.json({ success: true, extracted });
  } catch (err) {
    console.error("PDF parse error:", err);
    res.status(422).json({ success: false, error: "Nepodarilo sa spracovať PDF súbor" });
  }
}
