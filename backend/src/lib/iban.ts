/** Standard ISO 7064 MOD 97-10 IBAN check-digit validation (catches typos beyond just format). */
export function isValidIbanChecksum(iban: string): boolean {
  const normalized = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return BigInt(numeric) % 97n === 1n;
}
