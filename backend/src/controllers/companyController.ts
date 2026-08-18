import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { companyProfileSchema, sapiSkCredentialSchema } from "../validators/schemas";
import { encryptSecret } from "../lib/crypto";

export async function getCompanyProfile(req: Request, res: Response) {
  const profile = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });
  res.json(profile);
}

export async function upsertCompanyProfile(req: Request, res: Response) {
  const parsed = companyProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const profile = await prisma.companyProfile.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, ...parsed.data },
    update: { ...parsed.data },
  });
  res.json(profile);
}

export async function getSapiSkStatus(req: Request, res: Response) {
  const cred = await prisma.sapiSkCredential.findUnique({ where: { userId: req.userId! } });
  if (!cred) return res.json({ configured: false, mode: "mock" as const });
  res.json({ configured: true, mode: cred.mode, clientId: cred.clientId });
}

export async function setSapiSkCredential(req: Request, res: Response) {
  const parsed = sapiSkCredentialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje" });
  }
  const { clientId, clientSecret } = parsed.data;

  // New/updated credentials always start in "mock" mode — switching to "live" is a
  // separate, explicit action so nobody accidentally sends a real Peppol document.
  const cred = await prisma.sapiSkCredential.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, clientId, encryptedClientSecret: encryptSecret(clientSecret), mode: "mock" },
    update: { clientId, encryptedClientSecret: encryptSecret(clientSecret), mode: "mock" },
  });
  res.json({ configured: true, mode: cred.mode, clientId: cred.clientId });
}

export async function setSapiSkMode(req: Request, res: Response) {
  const mode = req.body?.mode;
  if (mode !== "mock" && mode !== "live") {
    return res.status(400).json({ error: 'mode musí byť "mock" alebo "live"' });
  }
  const existing = await prisma.sapiSkCredential.findUnique({ where: { userId: req.userId! } });
  if (!existing) {
    return res.status(400).json({ error: "Najprv nastav SAPI-SK prihlasovacie údaje" });
  }
  const cred = await prisma.sapiSkCredential.update({ where: { userId: req.userId! }, data: { mode } });
  res.json({ configured: true, mode: cred.mode, clientId: cred.clientId });
}

export async function deleteSapiSkCredential(req: Request, res: Response) {
  await prisma.sapiSkCredential.deleteMany({ where: { userId: req.userId! } });
  res.status(204).send();
}
