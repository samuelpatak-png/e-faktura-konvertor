import { describe, expect, it } from "vitest";
import { agingBucket, computePaymentStatus, daysOverdue, isOverdue } from "./paymentStatus";

describe("computePaymentStatus", () => {
  it("is UNPAID when nothing has been paid", () => {
    expect(computePaymentStatus(0, 10000)).toBe("UNPAID");
  });

  it("is PARTIALLY_PAID for a partial payment", () => {
    expect(computePaymentStatus(4000, 10000)).toBe("PARTIALLY_PAID");
  });

  it("is PAID for an exact-to-the-cent payment", () => {
    expect(computePaymentStatus(10000, 10000)).toBe("PAID");
  });

  it("is PAID if somehow paid more (defensive — callers should reject this before it gets here)", () => {
    expect(computePaymentStatus(10001, 10000)).toBe("PAID");
  });
});

describe("isOverdue", () => {
  const today = new Date("2026-08-20T12:00:00Z");

  it("is not overdue when due date is today", () => {
    expect(isOverdue("2026-08-20", "UNPAID", today)).toBe(false);
  });

  it("is not overdue when due date is in the future", () => {
    expect(isOverdue("2026-08-21", "UNPAID", today)).toBe(false);
  });

  it("is overdue when due date is in the past and still unpaid", () => {
    expect(isOverdue("2026-08-19", "UNPAID", today)).toBe(true);
  });

  it("is overdue when past due and only partially paid", () => {
    expect(isOverdue("2026-08-01", "PARTIALLY_PAID", today)).toBe(true);
  });

  it("is never overdue once PAID, even with a past due date", () => {
    expect(isOverdue("2026-01-01", "PAID", today)).toBe(false);
  });

  it("is never overdue once CANCELLED, even with a past due date", () => {
    expect(isOverdue("2026-01-01", "CANCELLED", today)).toBe(false);
  });
});

describe("daysOverdue", () => {
  const today = new Date("2026-08-20T12:00:00Z");

  it("is 0 when due today", () => {
    expect(daysOverdue("2026-08-20", today)).toBe(0);
  });

  it("is 0 when not yet due", () => {
    expect(daysOverdue("2026-09-01", today)).toBe(0);
  });

  it("counts whole days since the due date", () => {
    expect(daysOverdue("2026-08-10", today)).toBe(10);
  });
});

describe("agingBucket", () => {
  it("buckets 0 days as notYetDue", () => {
    expect(agingBucket(0)).toBe("notYetDue");
  });

  it("buckets the 0-30 day boundary correctly", () => {
    expect(agingBucket(1)).toBe("days0to30");
    expect(agingBucket(30)).toBe("days0to30");
    expect(agingBucket(31)).toBe("days31to60");
  });

  it("buckets the 31-60 day boundary correctly", () => {
    expect(agingBucket(60)).toBe("days31to60");
    expect(agingBucket(61)).toBe("days60plus");
  });
});
