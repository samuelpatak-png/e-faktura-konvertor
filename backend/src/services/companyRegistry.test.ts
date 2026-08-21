import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupByIco } from "./companyRegistry";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("lookupByIco", () => {
  it("returns not_found for a malformed IČO without making a network call", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await lookupByIco("not-an-ico");
    expect(result).toEqual({ status: "not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a successful RPO response into a found result with CompanyRegistryData", async () => {
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
      status: "found",
      data: {
        name: "Testovacia firma s.r.o.",
        street: "Hlavná 42",
        city: "Bratislava",
        postalCode: "81101",
      },
    });
  });

  it("returns not_found when the entity has no results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as unknown as typeof fetch;

    expect(await lookupByIco("99999999")).toEqual({ status: "not_found" });
  });

  // Regression: an HTTP error response and "no results" used to both collapse to the same
  // `null`, which the frontend showed as "firma sa nenašla" (not found) even when the lookup
  // service itself was down/rate-limited/erroring — actively misleading, since it looks like
  // confirmation the IČO doesn't exist. These must now be distinguishable.
  it("returns unavailable (not not_found, not a throw) on an HTTP error response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toEqual({ status: "unavailable" });
  });

  it("returns unavailable (not a throw) when the network call rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toEqual({ status: "unavailable" });
  });

  it("returns unavailable (not a throw) on a malformed/unexpected response shape", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    }) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toEqual({ status: "unavailable" });
  });

  it("returns not_found (not unavailable) when the response parses but has no usable name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ addresses: [] }] }),
    }) as unknown as typeof fetch;
    expect(await lookupByIco("12345678")).toEqual({ status: "not_found" });
  });
});
