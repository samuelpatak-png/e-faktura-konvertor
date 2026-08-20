import { describe, expect, it } from "vitest";
import { invoiceLineSchema, partnerSchema, priceListItemSchema } from "./schemas";

const base = {
  description: "Test",
  quantity: 1,
  unitCode: "C62" as const,
  unitPrice: 10,
  taxRatePercent: 23 as const,
};

describe("invoiceLineSchema", () => {
  it("accepts a 0% VAT rate", () => {
    const result = invoiceLineSchema.safeParse({ ...base, taxRatePercent: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects a negative unit price", () => {
    const result = invoiceLineSchema.safeParse({ ...base, unitPrice: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(invoiceLineSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(invoiceLineSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
  });

  it("accepts a whole-euro and a 2-decimal unit price", () => {
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10 }).success).toBe(true);
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10.5 }).success).toBe(true);
    expect(invoiceLineSchema.safeParse({ ...base, unitPrice: 10.55 }).success).toBe(true);
  });

  it("rejects a unit price with more than 2 decimal places (prior overcharge-bug regression)", () => {
    const result = invoiceLineSchema.safeParse({ ...base, unitPrice: 0.125 });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported VAT rate", () => {
    // zod's .safeParse accepts unknown input at compile time — this is a runtime check.
    const result = invoiceLineSchema.safeParse({ ...base, taxRatePercent: 21 });
    expect(result.success).toBe(false);
  });

  it("accepts a unit code from the wider UN/ECE Rec 20 set added in WP2, not just the original 6", () => {
    expect(invoiceLineSchema.safeParse({ ...base, unitCode: "MTK" }).success).toBe(true);
  });

  it("rejects a unit code that isn't a real UN/ECE Rec 20 code", () => {
    expect(invoiceLineSchema.safeParse({ ...base, unitCode: "NOT_A_REAL_CODE" }).success).toBe(false);
  });
});

const validPartner = {
  name: "Zákazník s.r.o.",
  ico: "12345678",
  dic: "1234567890",
  icDph: "SK1234567890",
  street: "Hlavná 1",
  city: "Bratislava",
  postalCode: "81101",
  countryCode: "SK",
};

describe("partnerSchema", () => {
  it("accepts a fully populated partner", () => {
    expect(partnerSchema.safeParse(validPartner).success).toBe(true);
  });

  it("accepts null for every optional field (ico, icDph, peppolScheme, peppolId, email, note, category)", () => {
    const result = partnerSchema.safeParse({
      ...validPartner,
      ico: null,
      icDph: null,
      peppolScheme: null,
      peppolId: null,
      email: null,
      note: null,
      category: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing DIČ — every saved partner must be usable to prefill an invoice", () => {
    const { dic: _dic, ...withoutDic } = validPartner;
    expect(partnerSchema.safeParse(withoutDic).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(partnerSchema.safeParse({ ...validPartner, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects an IČO that isn't exactly 8 digits", () => {
    expect(partnerSchema.safeParse({ ...validPartner, ico: "123" }).success).toBe(false);
  });
});

const validPriceListItem = {
  name: "Konzultačná hodina",
  description: null,
  unitCode: "HUR",
  unitPrice: 45.5,
  vatRate: 23,
  sku: null,
};

describe("priceListItemSchema", () => {
  it("accepts a fully populated item", () => {
    expect(priceListItemSchema.safeParse(validPriceListItem).success).toBe(true);
  });

  it("rejects an invalid unit code", () => {
    expect(priceListItemSchema.safeParse({ ...validPriceListItem, unitCode: "NOT_A_REAL_CODE" }).success).toBe(false);
  });

  it("rejects a price with more than 2 decimal places", () => {
    expect(priceListItemSchema.safeParse({ ...validPriceListItem, unitPrice: 0.125 }).success).toBe(false);
  });

  it("rejects an unsupported VAT rate", () => {
    expect(priceListItemSchema.safeParse({ ...validPriceListItem, vatRate: 21 }).success).toBe(false);
  });

  it("accepts null description and sku", () => {
    expect(priceListItemSchema.safeParse({ ...validPriceListItem, description: null, sku: null }).success).toBe(true);
  });
});
