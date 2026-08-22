import { describe, expect, it } from "vitest";
import { generateLinkToken, hashLinkToken } from "./crypto";

describe("generateLinkToken", () => {
  it("produces a 64-char hex string (256 bits of entropy)", () => {
    const token = generateLinkToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is different on every call", () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a).not.toBe(b);
  });
});

describe("hashLinkToken", () => {
  it("is deterministic — the same token always hashes the same way", () => {
    const token = generateLinkToken();
    expect(hashLinkToken(token)).toBe(hashLinkToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashLinkToken(generateLinkToken())).not.toBe(hashLinkToken(generateLinkToken()));
  });

  it("never returns the plaintext token itself", () => {
    const token = generateLinkToken();
    expect(hashLinkToken(token)).not.toBe(token);
  });

  it("produces a 64-char hex SHA-256 digest", () => {
    expect(hashLinkToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
