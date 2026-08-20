import { describe, expect, it } from "vitest";
import { renderTemplate } from "./emailTemplate";

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
