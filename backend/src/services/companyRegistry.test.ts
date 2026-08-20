import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupByIco } from "./companyRegistry";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("lookupByIco", () => {
  it("returns null for a malformed IČO without making a network call", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await lookupByIco("not-an-ico");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a successful RPO response into CompanyRegistryData", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            fullNames: [{ value: "Testovacia firma s.r.o." }],
            addresses: [
              {
                street: "Hlavná",
                buildingNumber: "42",
                postalCodes: ["81101"],
                municipality: { value: "Bratislava" },
              },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await lookupByIco("12345678");
    expect(result).toEqual({
      name: "Testovacia firma s.r.o.",
      street: "Hlavná 42",
      city: "Bratislava",
      postalCode: "81101",
    });
  });

  it("returns null when the entity has no results (not found)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as unknown as typeof fetch;

    expect(await lookupByIco("99999999")).toBeNull();
  });

  it("returns null (not a throw) on an HTTP error response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toBeNull();
  });

  it("returns null (not a throw) when the network call rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toBeNull();
  });

  it("returns null (not a throw) on a malformed/unexpected response shape", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    }) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toBeNull();
  });
});
