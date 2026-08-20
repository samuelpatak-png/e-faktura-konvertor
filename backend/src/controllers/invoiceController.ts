import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { CompanyProfile, Invoice } from "@prisma/client";
import { invoiceInputSchema, recordPaymentSchema, type InvoiceInput } from "../validators/schemas";
import { computeInvoiceTotals, centsToEur, type ComputedInvoiceTotals } from "../services/invoiceMath";
import { validateComputedInvoice, type ValidationResult } from "../services/invoiceValidator";
import { generateInvoiceXml } from "../services/xmlGenerator";
import { decryptSecret } from "../lib/crypto";
import { sendInvoiceViaSapiSk } from "../services/sapiSkClient";
import { computePaymentStatus, isOverdue, daysOverdue, agingBucket } from "../services/paymentStatus";

async function loadSupplier(userId: string) {
  return prisma.companyProfile.findUnique({ where: { userId } });
}

function buildXml(data: InvoiceInput, supplier: CompanyProfile, totals: ComputedInvoiceTotals) {
  return generateInvoiceXml({
    number: data.number,
    issueDate: data.issueDate,
    dueDate: data.dueDate,
    buyerReference: data.buyerReference,
    currency: "EUR",
    supplier: {
      name: supplier.name,
      ico: supplier.ico,
      dic: supplier.dic,
      icDph: supplier.icDph ?? undefined,
      street: supplier.street,
      city: supplier.city,
      postalCode: supplier.postalCode,
      country: supplier.country,
      iban: supplier.iban,
      bic: supplier.bic ?? undefined,
    },
    customer: data.customer,
    lines: totals.lines,
    netAmountCents: totals.netAmountCents,
    taxAmountCents: totals.taxAmountCents,
    grossAmountCents: totals.grossAmountCents,
    taxBreakdown: totals.taxBreakdown,
  });
}

function validate(data: InvoiceInput, supplier: CompanyProfile, totals: ComputedInvoiceTotals): ValidationResult {
  return validateComputedInvoice({
    supplierDic: supplier.dic,
    supplierIcDph: supplier.icDph,
    customerDic: data.customer.dic,
    buyerReference: data.buyerReference,
    lines: totals.lines,
    netAmountCents: totals.netAmountCents,
    taxAmountCents: totals.taxAmountCents,
    grossAmountCents: totals.grossAmountCents,
    taxBreakdown: totals.taxBreakdown,
  });
}

function paymentFields(invoice: Pick<Invoice, "dueDate" | "paymentStatus">) {
  return {
    overdue: isOverdue(invoice.dueDate, invoice.paymentStatus),
    daysOverdue: daysOverdue(invoice.dueDate),
  };
}

function summaryFromTotals(totals: ComputedInvoiceTotals) {
  return {
    netAmount: centsToEur(totals.netAmountCents),
    taxAmount: centsToEur(totals.taxAmountCents),
    grossAmount: centsToEur(totals.grossAmountCents),
    taxBreakdown: totals.taxBreakdown.map((b) => ({
      taxRatePercent: b.taxRatePercent,
      taxableAmount: centsToEur(b.taxableAmountCents),
      taxAmount: centsToEur(b.taxAmountCents),
    })),
  };
}

export async function validateInvoice(req: Request, res: Response) {
  const parsed = invoiceInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ valid: false, errors: parsed.error.issues.map((i) => i.message), warnings: [] });
  }
  const supplier = await loadSupplier(req.userId!);
  if (!supplier) {
    return res.status(400).json({ valid: false, errors: ["Najprv vyplň údaje o svojej firme v Nastaveniach."], warnings: [] });
  }

  const totals = computeInvoiceTotals(parsed.data);
  const result = validate(parsed.data, supplier, totals);

  // XML preview only — nothing is persisted here. Regenerated (and saved) again on /generate,
  // which is cheap since this is a pure function of the same input.
  const xml = result.valid ? buildXml(parsed.data, supplier, totals) : undefined;

  res.json({ ...result, summary: summaryFromTotals(totals), xml });
}

export async function generateInvoice(req: Request, res: Response) {
  const parsed = invoiceInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.issues.map((i) => i.message) });
  }
  const supplier = await loadSupplier(req.userId!);
  if (!supplier) {
    return res.status(400).json({ success: false, errors: ["Najprv vyplň údaje o svojej firme v Nastaveniach."] });
  }

  const data = parsed.data;
  const totals = computeInvoiceTotals(data);
  const validation = validate(data, supplier, totals);

  if (!validation.valid) {
    return res.status(422).json({ success: false, validation, summary: summaryFromTotals(totals) });
  }

  const xml = buildXml(data, supplier, totals);

  try {
    const invoice = await prisma.invoice.create({
      data: {
        userId: req.userId!,
        number: data.number,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        buyerReference: data.buyerReference,
        currency: "EUR",
        status: "GENERATED",
        supplierName: supplier.name,
        supplierIco: supplier.ico,
        supplierDic: supplier.dic,
        supplierIcDph: supplier.icDph,
        supplierStreet: supplier.street,
        supplierCity: supplier.city,
        supplierPostalCode: supplier.postalCode,
        supplierCountry: supplier.country,
        supplierIban: supplier.iban,
        supplierBic: supplier.bic,
        customerName: data.customer.name,
        customerIco: data.customer.ico,
        customerDic: data.customer.dic,
        customerIcDph: data.customer.icDph,
        customerStreet: data.customer.street,
        customerCity: data.customer.city,
        customerPostalCode: data.customer.postalCode,
        customerCountry: data.customer.country,
        netAmountCents: totals.netAmountCents,
        taxAmountCents: totals.taxAmountCents,
        grossAmountCents: totals.grossAmountCents,
        xml,
        lines: {
          create: totals.lines.map((l) => ({
            sortOrder: l.sortOrder,
            description: l.description,
            quantity: l.quantity,
            unitCode: l.unitCode,
            unitPriceCents: l.unitPriceCents,
            taxRatePercent: l.taxRatePercent,
            lineNetCents: l.lineNetCents,
          })),
        },
      },
    });

    res.status(201).json({ success: true, invoiceId: invoice.id, xml, validation, summary: summaryFromTotals(totals) });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, errors: [`Faktúra s číslom "${data.number}" už existuje.`] });
    }
    throw err;
  }
}

export async function listInvoices(req: Request, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      issueDate: true,
      dueDate: true,
      status: true,
      customerName: true,
      grossAmountCents: true,
      currency: true,
      sentAt: true,
      createdAt: true,
      paymentStatus: true,
      paidAmountCents: true,
      paidAt: true,
    },
  });
  res.json(
    invoices.map((inv) => ({ ...inv, grossAmount: centsToEur(inv.grossAmountCents), ...paymentFields(inv) }))
  );
}

export async function getInvoice(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });
  res.json({ ...invoice, ...paymentFields(invoice) });
}

export async function downloadInvoice(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice || !invoice.xml) return res.status(404).json({ error: "Faktúra nenájdená" });
  // invoice.number is free-text (real invoice numbering conventions use "/" etc., so the input
  // schema doesn't restrict its charset) — sanitize here, at the one place it lands in a header,
  // rather than by over-constraining what a valid invoice number can be.
  const safeFilename = invoice.number.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="faktura_${safeFilename}.xml"`);
  res.send(invoice.xml);
}

export async function sendInvoiceViaSapi(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice || !invoice.xml) return res.status(404).json({ error: "Faktúra nenájdená" });

  const cred = await prisma.sapiSkCredential.findUnique({ where: { userId: req.userId! } });
  const mode: "mock" | "live" = cred?.mode === "live" ? "live" : "mock";

  const result = await sendInvoiceViaSapiSk({
    clientId: cred?.clientId ?? "mock-client",
    clientSecret: cred ? decryptSecret(cred.encryptedClientSecret) : "mock-secret",
    mode,
    senderParticipantId: `0245:${invoice.supplierDic}`,
    receiverParticipantId: `0245:${invoice.customerDic}`,
    documentId: invoice.number,
    xml: invoice.xml,
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: result.success ? "SENT" : "SEND_FAILED",
      sentAt: result.success ? new Date() : undefined,
      sapiProviderDocumentId: result.providerDocumentId,
    },
  });

  res.json(result);
}

export async function recordPayment(req: Request, res: Response) {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }

  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });

  if (invoice.paymentStatus === "CANCELLED") {
    return res.status(400).json({ error: "Faktúra je stornovaná, nemožno na ňu zaznamenať úhradu" });
  }

  const newPaidAmountCents = invoice.paidAmountCents + parsed.data.amountCents;
  if (newPaidAmountCents > invoice.grossAmountCents) {
    // Overpayment is rejected outright rather than accepted as a credit balance — see WP3
    // handoff for the reasoning (a real credit-balance ledger is out of scope here).
    const remaining = centsToEur(invoice.grossAmountCents - invoice.paidAmountCents);
    return res.status(400).json({ error: `Úhrada by presiahla sumu faktúry (zostáva uhradiť ${remaining.toFixed(2)} €)` });
  }

  const paymentStatus = computePaymentStatus(newPaidAmountCents, invoice.grossAmountCents);
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      paidAmountCents: newPaidAmountCents,
      paymentStatus,
      paidAt: paymentStatus === "PAID" ? new Date() : invoice.paidAt,
    },
    // The frontend re-renders the full invoice detail (including line items) from this
    // response — omitting `lines` here previously crashed that page after recording a payment.
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  res.json({ ...updated, ...paymentFields(updated) });
}

export async function cancelInvoice(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });

  if (invoice.paymentStatus === "PAID") {
    return res.status(400).json({ error: "Uhradenú faktúru nemožno takto stornovať — vystav dobropis." });
  }
  if (invoice.paymentStatus === "CANCELLED") {
    return res.status(400).json({ error: "Faktúra je už stornovaná" });
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { paymentStatus: "CANCELLED" },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  res.json({ ...updated, ...paymentFields(updated) });
}

export async function getUnpaidSummary(req: Request, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: { userId: req.userId!, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    select: { id: true, number: true, customerName: true, dueDate: true, grossAmountCents: true, paidAmountCents: true },
  });

  const buckets = {
    notYetDue: { count: 0, amountCents: 0 },
    days0to30: { count: 0, amountCents: 0 },
    days31to60: { count: 0, amountCents: 0 },
    days60plus: { count: 0, amountCents: 0 },
  };
  let totalOutstandingCents = 0;

  for (const inv of invoices) {
    const outstandingCents = inv.grossAmountCents - inv.paidAmountCents;
    totalOutstandingCents += outstandingCents;
    const bucket = buckets[agingBucket(daysOverdue(inv.dueDate))];
    bucket.count += 1;
    bucket.amountCents += outstandingCents;
  }

  res.json({ totalOutstandingCents, count: invoices.length, buckets });
}
