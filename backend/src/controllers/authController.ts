import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { registerSchema, loginSchema } from "../validators/schemas";
import { AUTH_COOKIE_NAME } from "../middleware/auth";

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Bcrypt hash of an arbitrary, unused password — compared against for unknown emails so
// login takes the same time whether or not the account exists (avoids leaking which via timing).
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8mAcMdV9EWm8j3ChmH3euXPXtGH.jK";

function setAuthCookie(res: Response, userId: string) {
  const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: "30d" });
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
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
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, companyProfile: true },
  });
  if (!user) return res.status(404).json({ error: "Používateľ nenájdený" });
  res.json(user);
}
