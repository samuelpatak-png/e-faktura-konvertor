import { describe, expect, it } from "vitest";
import { renderTemplate, buildInvoiceTemplateVars } from "./emailTemplate";

describe("renderTemplate", () => {
  it("substitutes all known variables", () => {
    const result = renderTemplate("Faktúra {{invoiceNumber}} na {{amount}}, splatná {{dueDate}}, pre {{customerName}}", {
      invoiceNumber: "2026-0001",
      amount: "123,00 €",
      dueDate: "03.09.2026",
      customerName: "Odberateľ s.r.o.",
    });
    expect(result).toBe("Faktúra 2026-0001 na 123,00 €, splatná 03.09.2026, pre Odberateľ s.r.o.");
  });

  it("substitutes reminderNumber when present", () => {
    const result = renderTemplate("Upomienka č. {{reminderNumber}} k faktúre {{invoiceNumber}}", {
      invoiceNumber: "2026-0001",
      amount: "1 €",
      dueDate: "x",
      customerName: "x",
      reminderNumber: "2",
    });
    expect(result).toBe("Upomienka č. 2 k faktúre 2026-0001");
  });

  it("leaves an unknown placeholder untouched instead of throwing", () => {
    const result = renderTemplate("Ahoj {{customerName}}, kód {{unknownVar}}", {
      invoiceNumber: "x",
      amount: "x",
      dueDate: "x",
      customerName: "Ján",
    });
    expect(result).toBe("Ahoj Ján, kód {{unknownVar}}");
  });

  it("substitutes the same variable used multiple times", () => {
    const result = renderTemplate("{{invoiceNumber}} - {{invoiceNumber}}", {
      invoiceNumber: "2026-0005",
      amount: "x",
      dueDate: "x",
      customerName: "x",
    });
    expect(result).toBe("2026-0005 - 2026-0005");
  });

  it("does nothing to a template with no placeholders", () => {
    expect(renderTemplate("Plain text", { invoiceNumber: "x", amount: "x", dueDate: "x", customerName: "x" })).toBe("Plain text");
  });
});

describe("buildInvoiceTemplateVars", () => {
  function baseInvoice(overrides: Partial<{ documentType: "INVOICE" | "CREDIT_NOTE" | "ADVANCE_TAX_DOCUMENT"; grossAmountCents: number; paidAmountCents: number; dueDate: string }> = {}) {
    return {
      number: "2026-0001",
      documentType: overrides.documentType ?? ("INVOICE" as const),
      dueDate: overrides.dueDate ?? "2026-09-03",
      grossAmountCents: overrides.grossAmountCents ?? 12300,
      paidAmountCents: overrides.paidAmountCents ?? 0,
      customerName: "Odberateľ s.r.o.",
    };
  }

  it("uses the full gross amount when nothing has been paid", () => {
    const vars = buildInvoiceTemplateVars(baseInvoice());
    expect(vars.amount).toContain("123,00");
  });

  it("uses the outstanding balance, not the full total, once a partial payment was made", () => {
    // regression: emails used to always state grossAmountCents even for a PARTIALLY_PAID
    // invoice, telling the customer they owed the full original amount after they'd already
    // paid part of it.
    const vars = buildInvoiceTemplateVars(baseInvoice({ grossAmountCents: 100000, paidAmountCents: 40000 }));
    expect(vars.amount).toContain("600,00");
    expect(vars.amount).not.toContain("1 000,00");
  });

  it("shows no due date for a CREDIT_NOTE, instead of the issueDate placeholder the DB column holds", () => {
    // regression: a credit note's dueDate column only ever holds a non-meaningful issueDate
    // placeholder (UBL CreditNoteType has no DueDate concept) — the email must not present that
    // as if it were a real due date, matching what buildPdfInvoiceInput already does for the PDF
    // attached to the same email.
    const vars = buildInvoiceTemplateVars(baseInvoice({ documentType: "CREDIT_NOTE", dueDate: "2026-08-20" }));
    expect(vars.dueDate).toBe("—");
  });

  it("shows the real due date for a normal INVOICE", () => {
    const vars = buildInvoiceTemplateVars(baseInvoice({ dueDate: "2026-09-03" }));
    expect(vars.dueDate).toBe("03.09.2026");
  });

  it("shows the real due date for an ADVANCE_TAX_DOCUMENT (only CREDIT_NOTE is nulled out)", () => {
    const vars = buildInvoiceTemplateVars(baseInvoice({ documentType: "ADVANCE_TAX_DOCUMENT", dueDate: "2026-09-03" }));
    expect(vars.dueDate).toBe("03.09.2026");
  });

  it("passes reminderNumber through as a string when given, and leaves it undefined otherwise", () => {
    expect(buildInvoiceTemplateVars(baseInvoice(), 2).reminderNumber).toBe("2");
    expect(buildInvoiceTemplateVars(baseInvoice()).reminderNumber).toBeUndefined();
  });
});
