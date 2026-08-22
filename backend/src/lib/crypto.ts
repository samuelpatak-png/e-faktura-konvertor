import crypto from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "hex");
const IV_LENGTH = 12;

/**
 * Encrypts a secret (e.g. a SAPI-SK client_secret) for storage at rest.
 * Output format: iv:authTag:ciphertext, all hex-encoded.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Generates a one-time link token (password reset, email verification) — 256 bits of entropy,
 * hex-encoded so it's a plain URL-safe string with no padding/escaping concerns.
 */
export function generateLinkToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hashes a link token for storage. Unlike a password, a link token is already high-entropy
 * random data (not something a human chose), so a fast SHA-256 comparison is the correct tool
 * here, not bcrypt's deliberately-slow KDF — the threat this defends against is "someone reads
 * the token column out of a DB dump", not "someone guesses a low-entropy secret".
 */
export function hashLinkToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
