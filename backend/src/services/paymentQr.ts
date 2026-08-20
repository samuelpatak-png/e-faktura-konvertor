import QRCode from "qrcode";
import { loadBysquarePay } from "./bysquarePayLoader";

export interface PaymentQrInput {
  iban: string;
  amountEur: number;
  variableSymbol: string;
  dueDateIso: string; // "YYYY-MM-DD" — converted to bysquare's expected YYYYMMDD internally
  note: string;
  beneficiaryName: string;
}

/**
 * Generates a PAY by square QR code (PNG) encoding a payment order — the Slovak national
 * standard for prefilling a bank transfer in a mobile banking app from a scanned code.
 *
 * QR technical parameters (error correction level, encoding mode) were taken from the
 * official specification (bysquare-PAYspecifications-1.2.0.pdf, section 3.14, Table 11) rather
 * than assumed — it specifies error correction level **L** (not the commonly-assumed M) and
 * Alphanumeric encoding mode. The bysquare-encoded string is base32hex (digits + uppercase
 * A-V), which is a subset of the QR Alphanumeric character set, so `qrcode` selects
 * Alphanumeric mode automatically without any special configuration.
 *
 * IMPORTANT: this has been verified programmatically (encode -> decode round-trip, see
 * paymentQr.test.ts) but NOT by scanning the generated code in a real banking app — that
 * verification is explicitly called out in the WP6 spec as something only a human with a
 * physical phone can do, and is still pending. Do not treat this as bank-verified.
 */
export async function generatePaymentQr(input: PaymentQrInput): Promise<Buffer> {
  const { encode, PaymentOptions, CurrencyCode } = await loadBysquarePay();
  const qrString = encode({
    payments: [
      {
        type: PaymentOptions.PaymentOrder,
        amount: input.amountEur,
        currencyCode: CurrencyCode.EUR,
        variableSymbol: input.variableSymbol.replace(/\D/g, "").slice(0, 10) || undefined,
        paymentDueDate: input.dueDateIso.replace(/-/g, ""),
        paymentNote: input.note.slice(0, 140),
        beneficiary: { name: input.beneficiaryName },
        bankAccounts: [{ iban: input.iban.replace(/\s+/g, "") }],
      },
    ],
  });

  return QRCode.toBuffer(qrString, {
    errorCorrectionLevel: "L",
    margin: 2,
    scale: 8,
  });
}
