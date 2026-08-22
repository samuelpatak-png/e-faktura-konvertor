import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// Catches obviously-weak secrets (all-same-char, short repeating patterns, placeholder-style
// values) without needing a full entropy library — a real crypto.randomBytes()-generated secret
// has far more distinct characters than this threshold requires.
function hasEnoughDistinctChars(minDistinct: number) {
  return (v: string) => new Set(v.toLowerCase()).size >= minDistinct;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters — see .env.example")
    .refine(hasEnoughDistinctChars(12), "JWT_SECRET looks too low-entropy (repeated/simple characters) — generate a real random secret, see .env.example"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — see .env.example")
    .refine(hasEnoughDistinctChars(8), "CREDENTIAL_ENCRYPTION_KEY looks too low-entropy (repeated/simple hex pattern) — generate a real random key, see .env.example"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  SAPI_SK_MODE: z.enum(["mock", "live"]).default("mock"),
  SAPI_SK_BASE_URL: z.string().default("https://api.efaktura.sk/sapi"),

  // System-level SMTP for transactional auth emails (password reset, email verification) — a
  // separate concept from the per-tenant EmailSettings used to send invoices/reminders to a
  // company's own customers. All optional: the app must still boot without them (self-hosted
  // deploys that don't need those two flows), and the affected endpoints just log server-side
  // and answer generically rather than erroring out — see authController.ts.
  APP_SMTP_HOST: z.string().optional(),
  APP_SMTP_PORT: z.coerce.number().optional(),
  APP_SMTP_SECURE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  APP_SMTP_USER: z.string().optional(),
  APP_SMTP_PASSWORD: z.string().optional(),
  APP_SMTP_FROM_EMAIL: z.string().optional(),
  APP_SMTP_FROM_NAME: z.string().default("e-Faktúra Konvertor"),

  // Optional — Sentry stays fully inactive (no-op init) when unset. See instrument.ts.
  SENTRY_DSN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("\nCopy backend/.env.example to backend/.env and fill in the required values.");
  process.exit(1);
}

export const env = parsed.data;
