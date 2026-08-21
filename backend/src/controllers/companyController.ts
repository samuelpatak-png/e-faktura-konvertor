import type { Request, Response } from "express";
import type { EmailSettings } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { companyProfileSchema, sapiSkCredentialSchema, emailSettingsSchema, reminderSettingsSchema } from "../validators/schemas";
import { encryptSecret } from "../lib/crypto";

type BrandingAsset = "logo" | "stamp" | "signature";
const BRANDING_ASSETS: BrandingAsset[] = ["logo", "stamp", "signature"];

export async function updateBranding(req: Request, res: Response) {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const data: Record<string, string | null> = {};

  for (const asset of BRANDING_ASSETS) {
    const file = files[asset]?.[0];
    if (file) {
      data[`${asset}Data`] = file.buffer.toString("base64");
      data[`${asset}MimeType`] = file.mimetype;
    }
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nahraj aspoň jeden súbor (logo, pečiatka alebo podpis)" });
  }

  // .update() throws (P2025) on a userId with no CompanyProfile row yet — check first so a new
  // user who hasn't saved their company profile gets a clear message, not a generic 500.
  const existing = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });
  if (!existing) {
    return res.status(400).json({ error: "Najprv vyplň údaje o svojej firme v Nastaveniach." });
  }

  const profile = await prisma.companyProfile.update({ where: { userId: req.userId! }, data });
  res.json(brandingDto(profile));
}

export async function removeBrandingAsset(req: Request, res: Response) {
  const asset = req.params.asset as string;
  if (!BRANDING_ASSETS.includes(asset as BrandingAsset)) {
    return res.status(400).json({ error: "Neznámy typ (logo, stamp alebo signature)" });
  }
  const existing = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });
  if (!existing) {
    return res.status(400).json({ error: "Najprv vyplň údaje o svojej firme v Nastaveniach." });
  }
  const profile = await prisma.companyProfile.update({
    where: { userId: req.userId! },
    data: { [`${asset}Data`]: null, [`${asset}MimeType`]: null },
  });
  res.json(brandingDto(profile));
}

function brandingDto(profile: { logoMimeType: string | null; stampMimeType: string | null; signatureMimeType: string | null }) {
  return {
    logo: profile.logoMimeType !== null,
    stamp: profile.stampMimeType !== null,
    signature: profile.signatureMimeType !== null,
  };
}

export async function getCompanyProfile(req: Request, res: Response) {
  const profile = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });
  if (!profile) return res.json(null);
  // Never send the base64 blobs on the general profile fetch — just whether each is set.
  // Image previews load from GET /company/branding/:asset (a plain <img src>, same-origin
  // cookie auth) instead.
  const { logoData: _logoData, stampData: _stampData, signatureData: _signatureData, ...rest } = profile;
  res.json({ ...rest, ...brandingDto(profile) });
}

export async function getBrandingAsset(req: Request, res: Response) {
  const asset = req.params.asset as string;
  if (!BRANDING_ASSETS.includes(asset as BrandingAsset)) {
    return res.status(400).json({ error: "Neznámy typ (logo, stamp alebo signature)" });
  }
  const profile = await prisma.companyProfile.findUnique({ where: { userId: req.userId! } });
  const data = profile?.[`${asset}Data` as keyof typeof profile] as string | null | undefined;
  const mimeType = profile?.[`${asset}MimeType` as keyof typeof profile] as string | null | undefined;
  if (!data || !mimeType) return res.status(404).json({ error: "Súbor nie je nastavený" });
  res.setHeader("Content-Type", mimeType);
  res.send(Buffer.from(data, "base64"));
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

function emailSettingsDto(settings: EmailSettings) {
  // Never send the encrypted (or any) password back — same rule as SapiSkCredential.
  const { encryptedSmtpPassword: _encryptedSmtpPassword, ...rest } = settings;
  return { ...rest, configured: true };
}

export async function getEmailSettings(req: Request, res: Response) {
  const settings = await prisma.emailSettings.findUnique({ where: { userId: req.userId! } });
  if (!settings) return res.json({ configured: false });
  res.json(emailSettingsDto(settings));
}

export async function saveEmailSettings(req: Request, res: Response) {
  const parsed = emailSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const { smtpPassword, ...rest } = parsed.data;
  const existing = await prisma.emailSettings.findUnique({ where: { userId: req.userId! } });
  if (!existing && !smtpPassword) {
    return res.status(400).json({ error: "SMTP heslo je povinné pri prvom nastavení." });
  }
  // Empty password on an update means "leave it as-is" — keep the previously-stored ciphertext
  // instead of re-encrypting an empty string, so editing an unrelated field (e.g. the email
  // template) doesn't force re-entering a credential the frontend never gets to redisplay.
  const encryptedSmtpPassword = smtpPassword ? encryptSecret(smtpPassword) : existing!.encryptedSmtpPassword;
  const settings = await prisma.emailSettings.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, ...rest, encryptedSmtpPassword },
    update: { ...rest, encryptedSmtpPassword },
  });
  res.json(emailSettingsDto(settings));
}

export async function deleteEmailSettings(req: Request, res: Response) {
  await prisma.emailSettings.deleteMany({ where: { userId: req.userId! } });
  res.status(204).send();
}

export async function getReminderSettings(req: Request, res: Response) {
  const settings = await prisma.reminderSettings.findUnique({ where: { userId: req.userId! } });
  res.json(settings);
}

export async function saveReminderSettings(req: Request, res: Response) {
  const parsed = reminderSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const settings = await prisma.reminderSettings.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, ...parsed.data },
    update: { ...parsed.data },
  });
  res.json(settings);
}
