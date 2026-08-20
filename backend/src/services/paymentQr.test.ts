import { describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { decode } from "bysquare/pay";
import { generatePaymentQr } from "./paymentQr";

// production code loads bysquare/pay via a `new Function`-based dynamic import (see
// bysquarePayLoader.ts) because that's the only thing that works under the real, CommonJS-
// compiled server runtime — but that same trick throws inside Vitest's worker-thread sandbox
// ("A dynamic import callback was not specified", a V8 embedder-level restriction on
// dynamically-compiled code). Swap the loader boundary for a plain static import instead, which
// Vitest resolves natively via Vite's ESM pipeline — this is the exact same real bysquare/pay
// module and exercises the exact same encode() logic, just loaded a different way.
vi.mock("./bysquarePayLoader", async () => {
  const real = await import("bysquare/pay");
  return { loadBysquarePay: async () => real };
});

/**
 * Decodes an actual QR PNG image back into its encoded string — the same operation a phone
 * camera performs. This is the strongest automated check available without a physical
 * device: it exercises the real rendered pixels, not just the pre-render bysquare string.
 */
function decodeQrPng(png: Buffer): string {
  const decoded = PNG.sync.read(png);
  const result = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
  if (!result) throw new Error("jsQR could not decode the generated QR image");
  return result.data;
}

describe("generatePaymentQr", () => {
  it("produces a PNG that a QR scanner can read back to the exact payment data submitted", async () => {
    const png = await generatePaymentQr({
      iban: "SK3112000000198742637541",
      amountEur: 123.45,
      variableSymbol: "2026001",
      dueDateIso: "2026-09-15",
      note: "Faktura 2026-0001",
      beneficiaryName: "Moja Testovacia Firma s.r.o.",
    });

    expect(png.length).toBeGreaterThan(0);

    const qrString = decodeQrPng(png);
    const payment = decode(qrString).payments[0];

    expect(payment.amount).toBe(123.45);
    expect(payment.currencyCode).toBe("EUR");
    expect(payment.variableSymbol).toBe("2026001");
    expect(payment.paymentDueDate).toBe("20260915");
    expect(payment.paymentNote).toBe("Faktura 2026-0001");
    expect(payment.bankAccounts?.[0]?.iban).toBe("SK3112000000198742637541");
  });

  it("strips non-digit characters and truncates an overlong variable symbol to the 10-digit max", async () => {
    const png = await generatePaymentQr({
      iban: "SK3112000000198742637541",
      amountEur: 10,
      variableSymbol: "VS-2026-00099999999",
      dueDateIso: "2026-09-15",
      note: "x",
      beneficiaryName: "Firma",
    });
    const payment = decode(decodeQrPng(png)).payments[0];
    expect(payment.variableSymbol).toMatch(/^\d{1,10}$/);
  });

  it("removes whitespace from a formatted IBAN", async () => {
    const png = await generatePaymentQr({
      iban: "SK31 1200 0000 1987 4263 7541",
      amountEur: 10,
      variableSymbol: "1",
      dueDateIso: "2026-09-15",
      note: "x",
      beneficiaryName: "Firma",
    });
    const payment = decode(decodeQrPng(png)).payments[0];
    expect(payment.bankAccounts?.[0]?.iban).toBe("SK3112000000198742637541");
  });
});
