import type { Request, Response } from "express";
import type { ReceivedInvoice } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { parseUblDocument, UblParseError } from "../services/ublParser";
import { validateParsedDocument } from "../services/receivedInvoiceValidator";
import { runKositValidation } from "../services/kositRunner";
import { computePaymentStatus, isOverdue, daysOverdue } from "../services/paymentStatus";
import { recordPaymentSchema } from "../validators/schemas";
import { centsToEur } from "../services/invoiceMath";

// Mirrors invoiceController.ts's InvoiceBusinessRuleError — thrown inside a prisma.$transaction
// callback so a business-rule rejection aborts the transaction while still reaching the
// controller's own catch with a specific status/message.
class ReceivedInvoiceBusinessRuleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function toDto(inv: ReceivedInvoice) {
  return {
    id: inv.id,
    documentType: inv.documentType,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    supplierName: inv.supplierName,
    supplierIco: inv.supplierIco,
    supplierDic: inv.supplierDic,
    supplierIcDph: inv.supplierIcDph,
    supplierStreet: inv.supplierStreet,
    supplierCity: inv.supplierCity,
    supplierPostalCode: inv.supplierPostalCode,
    supplierCountry: inv.supplierCountry,
    customerName: inv.customerName,
    customerDic: inv.customerDic,
    netAmountCents: inv.netAmountCents,
    taxAmountCents: inv.taxAmountCents,
    grossAmountCents: inv.grossAmountCents,
    grossAmount: centsToEur(inv.grossAmountCents),
    lines: JSON.parse(inv.linesJson),
    paidAmountCents: inv.paidAmountCents,
    paidAt: inv.paidAt,
    paymentStatus: inv.paymentStatus,
    overdue: inv.dueDate ? isOverdue(inv.dueDate, inv.paymentStatus) : false,
    daysOverdue: inv.dueDate ? daysOverdue(inv.dueDate) : 0,
    fileName: inv.fileName,
    ourErrors: JSON.parse(inv.ourErrors),
    ourWarnings: JSON.parse(inv.ourWarnings),
    kositAcceptable: inv.kositAcceptable,
    kositMessages: inv.kositMessages ? JSON.parse(inv.kositMessages) : [],
    createdAt: inv.createdAt,
  };
}

export async function uploadReceivedInvoice(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "Nahraj XML súbor (pole 'file')" });
  }

  const xmlContent = req.file.buffer.toString("utf8");

  let parsed;
  try {
    parsed = parseUblDocument(xmlContent);
  } catch (err) {
    if (err instanceof UblParseError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  const ourValidation = validateParsedDocument(parsed);
  const kosit = await runKositValidation(xmlContent);

  const received = await prisma.receivedInvoice.create({
    data: {
      userId: req.userId!,
      documentType: parsed.documentType,
      number: parsed.number,
      issueDate: parsed.issueDate,
      dueDate: parsed.dueDate,
      currency: parsed.currency,
      supplierName: parsed.supplier.name,
      supplierIco: parsed.supplier.ico,
      supplierDic: parsed.supplier.dic,
      supplierIcDph: parsed.supplier.icDph,
      supplierStreet: parsed.supplier.street,
      supplierCity: parsed.supplier.city,
      supplierPostalCode: parsed.supplier.postalCode,
      supplierCountry: parsed.supplier.country,
      customerName: parsed.customer.name,
      customerDic: parsed.customer.dic,
      netAmountCents: parsed.netAmountCents,
      taxAmountCents: parsed.taxAmountCents,
      grossAmountCents: parsed.grossAmountCents,
      linesJson: JSON.stringify(parsed.lines),
      rawXml: xmlContent,
      fileName: req.file.originalname,
      ourErrors: JSON.stringify(ourValidation.errors),
      ourWarnings: JSON.stringify(ourValidation.warnings),
      kositAcceptable: kosit.available ? kosit.acceptable : null,
      kositMessages: JSON.stringify(kosit.messages),
    },
  });

  res.status(201).json({ ...toDto(received), kositAvailable: kosit.available });
}

export async function listReceivedInvoices(req: Request, res: Response) {
  const invoices = await prisma.receivedInvoice.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json(invoices.map(toDto));
}

export async function getReceivedInvoice(req: Request, res: Response) {
  const invoice = await prisma.receivedInvoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });
  res.json(toDto(invoice));
}

export async function downloadReceivedInvoiceXml(req: Request, res: Response) {
  const invoice = await prisma.receivedInvoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });
  const safeFilename = invoice.number.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="prijata_${safeFilename}.xml"`);
  res.send(invoice.rawXml);
}

export async function recordReceivedInvoicePayment(req: Request, res: Response) {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }

  const existing = await prisma.receivedInvoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Faktúra nenájdená" });
  // A received CREDIT_NOTE isn't itself something we owe money on — same rule as the outgoing
  // side (invoiceController.recordPayment restricts to documentType INVOICE).
  if (existing.documentType !== "INVOICE") {
    return res.status(400).json({ error: "Úhradu možno zaznamenať len na prijatú faktúru, nie na dobropis." });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction — two concurrent payments on the same received invoice
      // must not both compute their cap off the same pre-transaction paidAmountCents (a lost
      // update). Same pattern as invoiceController.recordPayment.
      const invoice = await tx.receivedInvoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
      if (!invoice) throw new ReceivedInvoiceBusinessRuleError("Faktúra nenájdená", 404);
      if (invoice.paymentStatus === "CANCELLED") {
        throw new ReceivedInvoiceBusinessRuleError("Faktúra je označená ako stornovaná, nemožno na ňu zaznamenať úhradu");
      }

      const newPaidAmountCents = invoice.paidAmountCents + parsed.data.amountCents;
      if (newPaidAmountCents > invoice.grossAmountCents) {
        const remaining = centsToEur(invoice.grossAmountCents - invoice.paidAmountCents);
        throw new ReceivedInvoiceBusinessRuleError(`Úhrada by presiahla sumu faktúry (zostáva uhradiť ${remaining.toFixed(2)} €)`);
      }

      const paymentStatus = computePaymentStatus(newPaidAmountCents, invoice.grossAmountCents);
      return tx.receivedInvoice.update({
        where: { id: invoice.id },
        data: { paidAmountCents: newPaidAmountCents, paymentStatus, paidAt: paymentStatus === "PAID" ? new Date() : invoice.paidAt },
      });
    });
    res.json(toDto(updated));
  } catch (err) {
    if (err instanceof ReceivedInvoiceBusinessRuleError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

export async function deleteReceivedInvoice(req: Request, res: Response) {
  const invoice = await prisma.receivedInvoice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invoice) return res.status(404).json({ error: "Faktúra nenájdená" });
  await prisma.receivedInvoice.delete({ where: { id: invoice.id } });
  res.status(204).send();
}
