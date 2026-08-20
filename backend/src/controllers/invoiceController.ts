import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { CompanyProfile, Invoice } from "@prisma/client";
import { invoiceInputSchema, recordPaymentSchema, creditNoteInputSchema, type InvoiceInput } from "../validators/schemas";
import { computeInvoiceTotals, centsToEur, taxBreakdownFromLines, type ComputedInvoiceTotals } from "../services/invoiceMath";
import { validateComputedInvoice, type ValidationResult } from "../services/invoiceValidator";
import { generateInvoiceXml, generateCreditNoteXml } from "../services/xmlGenerator";
import { generateInvoicePdf, type PdfInvoiceInput, type BrandingImage } from "../services/pdfGenerator";
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
    invoiceTypeCode: data.isAdvanceTaxDocument ? "386" : "380",
    prepaidAmountCents: data.prepaidAmountCents,
    prepaidReference: data.prepaidReference,
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

  if (data.isAdvanceTaxDocument && !supplier.icDph) {
    return res.status(400).json({
      success: false,
      errors: ["Daňový doklad k prijatej platbe môže vystaviť len platca DPH (chýba IČ DPH v Nastaveniach)."],
    });
  }

  const totals = computeInvoiceTotals(data);

  if (data.prepaidAmountCents && data.prepaidAmountCents > totals.grossAmountCents) {
    return res.status(400).json({ success: false, errors: ["Uhradený preddavok nemôže presiahnuť sumu faktúry."] });
  }

  const validation = validate(data, supplier, totals);

  if (!validation.valid) {
    return res.status(422).json({ success: false, validation, summary: summaryFromTotals(totals) });
  }

  const xml = buildXml(data, supplier, totals);
  const paidAmountCents = data.prepaidAmountCents ?? 0;

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
        documentType: data.isAdvanceTaxDocument ? "ADVANCE_TAX_DOCUMENT" : "INVOICE",
        prepaidAmountCents: data.prepaidAmountCents,
        prepaidReference: data.prepaidReference,
        // A declared prepayment counts as already paid on this invoice from day one — see WP4
        // handoff for why (the money was already received, just not yet against *this* row).
        paidAmountCents,
        paymentStatus: computePaymentStatus(paidAmountCents, totals.grossAmountCents),
        paidAt: paidAmountCents > 0 && paidAmountCents >= totals.grossAmountCents ? new Date() : undefined,
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
      documentType: true,
      originalInvoiceId: true,
    },
  });
  res.json(
    invoices.map((inv) => ({ ...inv, grossAmount: centsToEur(inv.grossAmountCents), ...paymentFields(inv) }))
  );
}

export async function getInvoice(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      original: { select: { id: true, number: true, issueDate: true } },
      corrections: { select: { id: true, number: true, issueDate: true, grossAmountCents: true } },
    },
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

function brandingImage(data: string | null, mimeType: string | null): BrandingImage | undefined {
  if (!data || !mimeType) return undefined;
  return { data: Buffer.from(data, "base64"), mimeType };
}

export async function downloadInvoicePdf(req: Request, res: Response) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      original: { select: { number: true } },
    },
  });
  if (!invoice || !invoice.xml) return res.status(404).json({ error: "Faktúra nenájdená" });

  // Branding is the company's *current* look, not part of the legal snapshot taken at
  // generation time (unlike supplier name/address/IBAN, which are frozen on the Invoice row).
  const profile = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });

  const input: PdfInvoiceInput = {
    documentType: invoice.documentType,
    number: invoice.number,
    issueDate: invoice.issueDate,
    // CreditNoteType has no DueDate concept in UBL (see createCreditNote above) — the DB column
    // is only ever populated with a non-meaningful placeholder for those rows, so don't print it.
    dueDate: invoice.documentType === "CREDIT_NOTE" ? null : invoice.dueDate,
    buyerReference: invoice.buyerReference,
    currency: invoice.currency,
    supplier: {
      name: invoice.supplierName,
      ico: invoice.supplierIco,
      dic: invoice.supplierDic,
      icDph: invoice.supplierIcDph,
      street: invoice.supplierStreet,
      city: invoice.supplierCity,
      postalCode: invoice.supplierPostalCode,
      country: invoice.supplierCountry,
      iban: invoice.supplierIban,
      bic: invoice.supplierBic,
    },
    customer: {
      name: invoice.customerName,
      ico: invoice.customerIco,
      dic: invoice.customerDic,
      icDph: invoice.customerIcDph,
      street: invoice.customerStreet,
      city: invoice.customerCity,
      postalCode: invoice.customerPostalCode,
      country: invoice.customerCountry,
    },
    lines: invoice.lines,
    netAmountCents: invoice.netAmountCents,
    taxAmountCents: invoice.taxAmountCents,
    grossAmountCents: invoice.grossAmountCents,
    taxBreakdown: taxBreakdownFromLines(invoice.lines),
    prepaidAmountCents: invoice.prepaidAmountCents ?? undefined,
    originalInvoiceNumber: invoice.original?.number,
    xmlContent: invoice.xml,
    branding: profile
      ? {
          logo: brandingImage(profile.logoData, profile.logoMimeType),
          stamp: brandingImage(profile.stampData, profile.stampMimeType),
          signature: brandingImage(profile.signatureData, profile.signatureMimeType),
        }
      : undefined,
  };

  const pdf = await generateInvoicePdf(input);
  const safeFilename = invoice.number.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="faktura_${safeFilename}.pdf"`);
  res.send(pdf);
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

  if (invoice.documentType !== "INVOICE") {
    return res.status(400).json({ error: "Úhradu možno zaznamenať len na bežnú faktúru." });
  }
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

  if (invoice.documentType !== "INVOICE") {
    return res.status(400).json({ error: "Stornovať možno len bežnú faktúru." });
  }
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
    // documentType: INVOICE only — a credit note or advance tax document isn't itself a
    // receivable in the "money someone still owes me for a delivery" sense this dashboard
    // tracks (see WP4 handoff).
    where: { userId: req.userId!, documentType: "INVOICE", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
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

export async function createCreditNote(req: Request, res: Response) {
  const parsed = creditNoteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.issues.map((i) => i.message) });
  }

  const original = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!original) return res.status(404).json({ success: false, errors: ["Faktúra nenájdená"] });
  if (original.documentType !== "INVOICE") {
    return res.status(400).json({ success: false, errors: ["Dobropis možno vystaviť len k bežnej faktúre."] });
  }
  if (original.paymentStatus === "CANCELLED") {
    return res.status(400).json({ success: false, errors: ["Faktúra je stornovaná — dobropis k nej nedáva zmysel."] });
  }

  const data = parsed.data;

  // No lines supplied → credit the original invoice in full (its own lines, verbatim).
  const lineInputs = data.lines ?? original.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitCode: l.unitCode,
    unitPrice: centsToEur(l.unitPriceCents),
    taxRatePercent: l.taxRatePercent as 23 | 19 | 5 | 0,
  }));

  const totals = computeInvoiceTotals({ lines: lineInputs });

  const alreadyCreditedCents = await prisma.invoice.aggregate({
    where: { userId: req.userId!, documentType: "CREDIT_NOTE", originalInvoiceId: original.id },
    _sum: { grossAmountCents: true },
  });
  const creditedSoFar = alreadyCreditedCents._sum.grossAmountCents ?? 0;
  if (creditedSoFar + totals.grossAmountCents > original.grossAmountCents) {
    const remaining = centsToEur(original.grossAmountCents - creditedSoFar);
    return res.status(400).json({
      success: false,
      errors: [`Súčet dobropisov by presiahol sumu pôvodnej faktúry (zostáva možné dobropisovať ${remaining.toFixed(2)} €).`],
    });
  }

  const buyerReference = data.buyerReference ?? original.buyerReference;

  const validation = validateComputedInvoice({
    supplierDic: original.supplierDic,
    supplierIcDph: original.supplierIcDph,
    customerDic: original.customerDic,
    buyerReference,
    lines: totals.lines,
    netAmountCents: totals.netAmountCents,
    taxAmountCents: totals.taxAmountCents,
    grossAmountCents: totals.grossAmountCents,
    taxBreakdown: totals.taxBreakdown,
  });
  if (!validation.valid) {
    return res.status(422).json({ success: false, validation, summary: summaryFromTotals(totals) });
  }

  const xml = generateCreditNoteXml({
    number: data.number,
    issueDate: data.issueDate,
    originalInvoiceNumber: original.number,
    originalInvoiceIssueDate: original.issueDate,
    buyerReference,
    currency: original.currency,
    note: data.reason,
    supplier: {
      name: original.supplierName,
      ico: original.supplierIco,
      dic: original.supplierDic,
      icDph: original.supplierIcDph ?? undefined,
      street: original.supplierStreet,
      city: original.supplierCity,
      postalCode: original.supplierPostalCode,
      country: original.supplierCountry,
      iban: original.supplierIban,
      bic: original.supplierBic ?? undefined,
    },
    customer: {
      name: original.customerName,
      ico: original.customerIco,
      dic: original.customerDic,
      icDph: original.customerIcDph ?? undefined,
      street: original.customerStreet,
      city: original.customerCity,
      postalCode: original.customerPostalCode,
      country: original.customerCountry,
    },
    lines: totals.lines,
    netAmountCents: totals.netAmountCents,
    taxAmountCents: totals.taxAmountCents,
    grossAmountCents: totals.grossAmountCents,
    taxBreakdown: totals.taxBreakdown,
  });

  try {
    const creditNote = await prisma.invoice.create({
      data: {
        userId: req.userId!,
        number: data.number,
        issueDate: data.issueDate,
        dueDate: data.issueDate, // CreditNoteType has no DueDate concept in UBL — see WP4 handoff
        buyerReference,
        currency: original.currency,
        status: "GENERATED",
        documentType: "CREDIT_NOTE",
        originalInvoiceId: original.id,
        supplierName: original.supplierName,
        supplierIco: original.supplierIco,
        supplierDic: original.supplierDic,
        supplierIcDph: original.supplierIcDph,
        supplierStreet: original.supplierStreet,
        supplierCity: original.supplierCity,
        supplierPostalCode: original.supplierPostalCode,
        supplierCountry: original.supplierCountry,
        supplierIban: original.supplierIban,
        supplierBic: original.supplierBic,
        customerName: original.customerName,
        customerIco: original.customerIco,
        customerDic: original.customerDic,
        customerIcDph: original.customerIcDph,
        customerStreet: original.customerStreet,
        customerCity: original.customerCity,
        customerPostalCode: original.customerPostalCode,
        customerCountry: original.customerCountry,
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

    res.status(201).json({ success: true, invoiceId: creditNote.id, xml, validation, summary: summaryFromTotals(totals) });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, errors: [`Doklad s číslom "${data.number}" už existuje.`] });
    }
    throw err;
  }
}
