import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { registerSchema, loginSchema, requestPasswordResetSchema, resetPasswordSchema, verifyEmailSchema } from "../validators/schemas";
import { AUTH_COOKIE_NAME } from "../middleware/auth";
import { profileDto } from "./companyController";
import { generateLinkToken, hashLinkToken } from "../lib/crypto";
import { getAppSmtpConfig } from "../lib/appSmtp";
import { sendEmail } from "../services/emailSender";

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Bcrypt hash of an arbitrary, unused password — compared against for unknown emails so
// login takes the same time whether or not the account exists (avoids leaking which via timing).
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8mAcMdV9EWm8j3ChmH3euXPXtGH.jK";

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hodina
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hodín — nižšie riziko než reset hesla
// Identical regardless of whether the email exists — same anti-enumeration reasoning as
// DUMMY_HASH above, applied to the response body instead of comparison timing.
const GENERIC_RESET_REQUESTED_MESSAGE = "Ak účet s týmto emailom existuje, poslali sme naň odkaz na obnovenie hesla.";

function appLink(path: string): string {
  return `${env.CORS_ORIGIN}${path}`;
}

/** Best-effort: never throws — a failed/unconfigured send must never block registration or a
 * logged-in user's own request, it only means the (non-blocking) verified badge stays unset. */
async function sendVerificationEmail(user: { id: string; email: string }): Promise<{ sent: boolean; error?: string }> {
  const smtp = getAppSmtpConfig();
  if (!smtp) {
    console.error("APP_SMTP nie je nastavené — nemožno odoslať overovací email.");
    return { sent: false, error: "Odosielanie emailov momentálne nie je nastavené." };
  }

  // A fresh request invalidates any earlier unused token — only the latest link should work.
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const token = generateLinkToken();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS) },
  });

  const result = await sendEmail({
    smtp,
    to: user.email,
    subject: "Potvrď svoj email — e-Faktúra Konvertor",
    text: `Dobrý deň,\n\npotvrď svoju emailovú adresu kliknutím na odkaz nižšie (platný 24 hodín):\n\n${appLink(`/verify-email?token=${token}`)}\n\nAk si o toto nežiadal, tento email môžeš ignorovať.`,
  });
  return { sent: result.success, error: result.error };
}

// A browser only deletes a cookie when the clearing Set-Cookie's attributes match the ones it
// was set with (path/secure/sameSite in particular) — shared so logout's clearCookie can never
// drift from what login/register actually set.
const AUTH_COOKIE_OPTIONS = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax" as const, path: "/" };

function setAuthCookie(res: Response, userId: string) {
  const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: "30d" });
  res.cookie(AUTH_COOKIE_NAME, token, { ...AUTH_COOKIE_OPTIONS, maxAge: COOKIE_MAX_AGE_MS });
}

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Účet s týmto emailom už existuje" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  try {
    await sendVerificationEmail(user);
  } catch (err) {
    // Never block registration on this — see sendVerificationEmail's own doc comment.
    console.error("Nepodarilo sa odoslať overovací email pri registrácii:", err);
  }

  setAuthCookie(res, user.id);
  res.status(201).json({ id: user.id, email: user.email });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    return res.status(401).json({ error: "Nesprávny email alebo heslo" });
  }

  setAuthCookie(res, user.id);
  res.json({ id: user.id, email: user.email });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS);
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, emailVerified: true, companyProfile: true },
  });
  if (!user) return res.status(404).json({ error: "Používateľ nenájdený" });
  // companyProfile here is the full row (blobs included) — select: { companyProfile: true }
  // with no nested select pulls every scalar column. Shape it through the same DTO
  // getCompanyProfile/upsertCompanyProfile use so /auth/me never ships base64 logo/stamp/
  // signature data on every page-load refresh.
  res.json({ ...user, companyProfile: user.companyProfile ? profileDto(user.companyProfile) : null });
}

export async function requestPasswordReset(req: Request, res: Response) {
  const parsed = requestPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje" });
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const smtp = getAppSmtpConfig();
    if (!smtp) {
      console.error("APP_SMTP nie je nastavené — nemožno odoslať odkaz na obnovenie hesla.");
    } else {
      // A fresh request invalidates any earlier unused token — only the latest link should work.
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const token = generateLinkToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS) },
      });
      await sendEmail({
        smtp,
        to: user.email,
        subject: "Obnovenie hesla — e-Faktúra Konvertor",
        text: `Dobrý deň,\n\npožiadal si o obnovenie hesla. Klikni na odkaz nižšie (platný 1 hodinu):\n\n${appLink(`/reset-password?token=${token}`)}\n\nAk si o toto nežiadal, tento email môžeš ignorovať — heslo zostane nezmenené.`,
      });
    }
  }

  // Always the same response whether or not the email exists — see GENERIC_RESET_REQUESTED_MESSAGE.
  res.json({ message: GENERIC_RESET_REQUESTED_MESSAGE });
}

export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje", details: parsed.error.flatten().fieldErrors });
  }
  const { token, newPassword } = parsed.data;

  const tokenRow = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashLinkToken(token) } });
  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    return res.status(400).json({ error: "Odkaz na obnovenie hesla je neplatný alebo vypršal." });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({ where: { id: tokenRow.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
  ]);

  // Logs the user in immediately — they've just proven control of the account's email, no
  // reason to make them go through a separate login step right after.
  setAuthCookie(res, updatedUser.id);
  res.json({ id: updatedUser.id, email: updatedUser.email });
}

export async function requestVerification(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "Používateľ nenájdený" });
  if (user.emailVerified) {
    return res.json({ message: "Email je už overený." });
  }

  const result = await sendVerificationEmail(user);
  if (!result.sent) {
    return res.status(502).json({ error: result.error ?? "Odoslanie zlyhalo" });
  }
  res.json({ message: "Overovací email bol odoslaný." });
}

export async function verifyEmail(req: Request, res: Response) {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Neplatné údaje" });
  }
  const { token } = parsed.data;

  const tokenRow = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashLinkToken(token) } });
  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    return res.status(400).json({ error: "Odkaz na overenie emailu je neplatný alebo vypršal." });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: tokenRow.userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
  ]);

  res.json({ success: true });
}
