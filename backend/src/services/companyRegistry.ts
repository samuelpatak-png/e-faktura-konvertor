// Best-effort lookup of a Slovak legal entity by IČO, used to prefill the partner form.
// NEVER load-bearing: every caller must treat a null result as "user fills it in manually" —
// this is a convenience, not a dependency, and manual entry always works regardless.
//
// UNVERIFIED AGAINST LIVE TRAFFIC — see WP1 handoff. The contract below matches the
// *documented* RPO (Register právnických osôb, podnikateľov a orgánov verejnej moci) REST
// API: https://susrrpo.docs.apiary.io/, https://rpo.minv.sk/rpo-api-doc.html, base URL
// https://api.statistics.sk/rpo/v1/. During development, a direct request to that production
// endpoint completed a full TLS handshake and then returned no HTTP response at all (not a
// 404/error — just silence until timeout). Search results note the v1 API may be deprecated
// in favor of an undocumented "V2" with no publicly findable contract. Could not confirm this
// against live traffic before shipping — do not treat "found: false" as proof the entity
// doesn't exist, it may just mean the lookup itself is unavailable right now.

export interface CompanyRegistryData {
  name: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
}

// "not_found" (the registry responded and genuinely has no match) and "unavailable" (network
// error, timeout, non-2xx response, or an unexpected response shape) collapsed to the same
// `null` before — but they mean very different things to a caller: "not_found" is fine to
// treat as "user fills it in manually", while "unavailable" must never be shown as if it were
// confirmed non-existence (see the file-level comment above).
export type CompanyRegistryLookupResult =
  | { status: "found"; data: CompanyRegistryData }
  | { status: "not_found" }
  | { status: "unavailable" };

const RPO_BASE_URL = "https://api.statistics.sk/rpo/v1";
const LOOKUP_TIMEOUT_MS = 5000;

interface RpoTimedValue {
  value: string;
}
interface RpoAddress {
  street?: string;
  buildingNumber?: string;
  postalCodes?: string[];
  municipality?: { value: string };
}
interface RpoSearchResult {
  fullNames?: RpoTimedValue[];
  addresses?: RpoAddress[];
}
interface RpoSearchResponse {
  results?: RpoSearchResult[];
}

export async function lookupByIco(ico: string): Promise<CompanyRegistryLookupResult> {
  if (!/^\d{8}$/.test(ico)) return { status: "not_found" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${RPO_BASE_URL}/search?identifier=${ico}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    // A non-2xx response means the lookup itself failed (rate limit, the API being down, a
    // malformed request) — it says nothing about whether this IČO exists.
    if (!response.ok) return { status: "unavailable" };

    const data = (await response.json()) as RpoSearchResponse;
    const entity = data.results?.[0];
    if (!entity) return { status: "not_found" };

    const name = entity.fullNames?.[0]?.value;
    if (!name) return { status: "not_found" };

    const address = entity.addresses?.[0];
    const street = address?.street ? [address.street, address.buildingNumber].filter(Boolean).join(" ") : null;

    return {
      status: "found",
      data: {
        name,
        street,
        city: address?.municipality?.value ?? null,
        postalCode: address?.postalCodes?.[0] ?? null,
      },
    };
  } catch {
    // Network error, timeout, or a response body that doesn't parse as JSON — genuinely "can't
    // tell right now", never conflated with "confirmed this IČO doesn't exist".
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
