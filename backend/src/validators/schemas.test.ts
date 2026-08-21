import { describe, expect, it } from "vitest";
import { customerSchema, emailSettingsSchema, invoiceLineSchema, partnerSchema, priceListItemSchema, reminderSettingsSchema, sendInvoiceEmailSchema } from "./schemas";

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

  it("lowercases a mixed-case email — intentional, consistent with User/customer email normalization elsewhere", () => {
    const result = partnerSchema.safeParse({ ...validPartner, email: "Jan.Novak@MojaFirma.SK" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jan.novak@mojafirma.sk");
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

describe("customerSchema email field (WP7)", () => {
  const validCustomer = {
    name: "Odberateľ s.r.o.",
    ico: null,
    dic: "2222222222",
    icDph: null,
    street: "Ulica 2",
    city: "Košice",
    postalCode: "04001",
    country: "SK",
    email: null,
  };

  it("accepts a customer with no email (optional — SAPI-SK delivery doesn't need one)", () => {
    expect(customerSchema.safeParse(validCustomer).success).toBe(true);
  });

  it("accepts a valid email and lowercases it", () => {
    const result = customerSchema.safeParse({ ...validCustomer, email: "Odberatel@Example.COM" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("odberatel@example.com");
  });

  it("rejects a malformed email instead of silently accepting it", () => {
    expect(customerSchema.safeParse({ ...validCustomer, email: "not-an-email" }).success).toBe(false);
  });
});

const validEmailSettings = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "faktury@mojafirma.sk",
  smtpPassword: "app-password-123",
  fromEmail: "faktury@mojafirma.sk",
  fromName: "Moja Firma s.r.o.",
  subjectTemplate: "Faktúra {{invoiceNumber}}",
  bodyTemplate: "Dobrý deň, v prílohe posielame faktúru {{invoiceNumber}}.",
};

describe("emailSettingsSchema", () => {
  it("accepts a fully populated config", () => {
    expect(emailSettingsSchema.safeParse(validEmailSettings).success).toBe(true);
  });

  it("rejects an out-of-range port", () => {
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, smtpPort: 70000 }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, smtpPort: 0 }).success).toBe(false);
  });

  it("rejects a malformed fromEmail", () => {
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, fromEmail: "not-an-email" }).success).toBe(false);
  });

  it("accepts an empty SMTP password — it means \"keep the existing one\", enforced as required only in the controller on first save", () => {
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, smtpPassword: "" }).success).toBe(true);
  });

  it("rejects an empty subject or body template", () => {
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, subjectTemplate: "" }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ ...validEmailSettings, bodyTemplate: "" }).success).toBe(false);
  });
});

const validReminderSettings = {
  enabled: true,
  firstReminderDays: 7,
  reminderCount: 3,
  intervalDays: 7,
  subjectTemplate: "Upomienka {{invoiceNumber}}",
  bodyTemplate: "Faktúra {{invoiceNumber}} nebola uhradená.",
};

describe("reminderSettingsSchema", () => {
  it("accepts a fully populated config", () => {
    expect(reminderSettingsSchema.safeParse(validReminderSettings).success).toBe(true);
  });

  it("rejects a zero or negative reminderCount", () => {
    expect(reminderSettingsSchema.safeParse({ ...validReminderSettings, reminderCount: 0 }).success).toBe(false);
    expect(reminderSettingsSchema.safeParse({ ...validReminderSettings, reminderCount: -1 }).success).toBe(false);
  });

  it("rejects a non-integer intervalDays", () => {
    expect(reminderSettingsSchema.safeParse({ ...validReminderSettings, intervalDays: 3.5 }).success).toBe(false);
  });
});

describe("sendInvoiceEmailSchema", () => {
  it("accepts an omitted `to` (falls back to the invoice's saved customerEmail)", () => {
    const result = sendInvoiceEmailSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.to).toBeUndefined();
  });

  it("accepts an empty string `to` the same as omitted", () => {
    const result = sendInvoiceEmailSchema.safeParse({ to: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.to).toBeUndefined();
  });

  it("rejects a malformed `to` override", () => {
    expect(sendInvoiceEmailSchema.safeParse({ to: "not-an-email" }).success).toBe(false);
  });
});
