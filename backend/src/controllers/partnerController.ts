import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { partnerSchema, partnerUpdateSchema, partnerListQuerySchema } from "../validators/schemas";
import { lookupByIco } from "../services/companyRegistry";

export async function listPartners(req: Request, res: Response) {
  const parsed = partnerListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné parametre", details: parsed.error.flatten().fieldErrors });
  }
  const { q, dic, page, pageSize, includeInactive } = parsed.data;

  const where = {
    userId: req.userId!,
    ...(includeInactive ? {} : { isActive: true }),
    ...(dic ? { dic } : {}),
    // Plain `contains` (no `mode: "insensitive"` — unsupported on the sqlite provider and
    // throws at runtime). SQLite's LIKE is ASCII-case-insensitive natively, so this is
    // reasonably case-insensitive already; it is not diacritic-aware.
    ...(q ? { OR: [{ name: { contains: q } }, { ico: { contains: q } }] } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.partner.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
}

export async function getPartner(req: Request, res: Response) {
  const partner = await prisma.partner.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!partner) return res.status(404).json({ error: "Odberateľ nenájdený" });
  res.json(partner);
}

export async function createPartner(req: Request, res: Response) {
  const parsed = partnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const partner = await prisma.partner.create({ data: { userId: req.userId!, ...parsed.data } });
  res.status(201).json(partner);
}

export async function updatePartner(req: Request, res: Response) {
  const parsed = partnerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  // findFirst (not findUnique on id alone) so a user can never update another user's partner
  // by guessing/enumerating ids.
  const existing = await prisma.partner.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Odberateľ nenájdený" });
  const partner = await prisma.partner.update({ where: { id: existing.id }, data: parsed.data });
  res.json(partner);
}

export async function deletePartner(req: Request, res: Response) {
  const existing = await prisma.partner.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Odberateľ nenájdený" });
  // Soft delete only — a partner may be referenced by historical invoices' snapshot data
  // (Invoice stores its own customer* fields, but the registry entry itself must survive).
  await prisma.partner.update({ where: { id: existing.id }, data: { isActive: false } });
  res.status(204).send();
}

export async function lookupPartnerByIco(req: Request, res: Response) {
  const ico = req.params.ico;
  if (!/^\d{8}$/.test(ico)) {
    return res.status(400).json({ error: "IČO musí mať presne 8 číslic" });
  }
  const data = await lookupByIco(ico);
  res.json({ found: data !== null, data });
}
