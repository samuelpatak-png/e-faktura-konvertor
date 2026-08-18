import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters — see .env.example"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — see .env.example"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  SAPI_SK_MODE: z.enum(["mock", "live"]).default("mock"),
  SAPI_SK_BASE_URL: z.string().default("https://api.efaktura.sk/sapi"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("\nCopy backend/.env.example to backend/.env and fill in the required values.");
  process.exit(1);
}

export const env = parsed.data;
