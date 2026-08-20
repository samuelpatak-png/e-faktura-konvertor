import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { priceListItemSchema, priceListItemUpdateSchema, priceListItemListQuerySchema } from "../validators/schemas";
import { eurToCents, centsToEur } from "../services/invoiceMath";

function withEuroPrice<T extends { unitPriceCents: number }>(item: T) {
  return { ...item, unitPrice: centsToEur(item.unitPriceCents) };
}

export async function listPriceListItems(req: Request, res: Response) {
  const parsed = priceListItemListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné parametre", details: parsed.error.flatten().fieldErrors });
  }
  const { q, page, pageSize, includeInactive } = parsed.data;

  const where = {
    userId: req.userId!,
    ...(includeInactive ? {} : { isActive: true }),
    // Plain `contains` (no `mode: "insensitive"` — unsupported on the sqlite provider).
    ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.priceListItem.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.priceListItem.count({ where }),
  ]);

  res.json({ items: items.map(withEuroPrice), total, page, pageSize });
}

export async function getPriceListItem(req: Request, res: Response) {
  const item = await prisma.priceListItem.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!item) return res.status(404).json({ error: "Položka cenníka nenájdená" });
  res.json(withEuroPrice(item));
}

export async function createPriceListItem(req: Request, res: Response) {
  const parsed = priceListItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const { unitPrice, ...rest } = parsed.data;
  const item = await prisma.priceListItem.create({ data: { userId: req.userId!, ...rest, unitPriceCents: eurToCents(unitPrice) } });
  res.status(201).json(withEuroPrice(item));
}

export async function updatePriceListItem(req: Request, res: Response) {
  const parsed = priceListItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  // findFirst (not findUnique on id alone) so a user can never update another user's item.
  const existing = await prisma.priceListItem.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Položka cenníka nenájdená" });

  const { unitPrice, ...rest } = parsed.data;
  const item = await prisma.priceListItem.update({
    where: { id: existing.id },
    data: { ...rest, unitPriceCents: eurToCents(unitPrice) },
  });
  res.json(withEuroPrice(item));
}

export async function deletePriceListItem(req: Request, res: Response) {
  const existing = await prisma.priceListItem.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Položka cenníka nenájdená" });
  await prisma.priceListItem.update({ where: { id: existing.id }, data: { isActive: false } });
  res.status(204).send();
}
