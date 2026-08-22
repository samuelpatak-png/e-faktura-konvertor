import { env } from "./env";
import type { SmtpConfig } from "../services/emailSender";

/**
 * System-level SMTP for transactional auth emails (password reset, email verification) — not
 * the per-tenant EmailSettings a company configures to email its own customers. Returns null
 * when the operator hasn't configured it; callers must degrade gracefully (log + generic
 * response), never surface a raw 500 for what's a deployment configuration gap, not a user error.
 */
export function getAppSmtpConfig(): SmtpConfig | null {
  if (!env.APP_SMTP_HOST || !env.APP_SMTP_PORT || !env.APP_SMTP_USER || !env.APP_SMTP_PASSWORD || !env.APP_SMTP_FROM_EMAIL) {
    return null;
  }
  return {
    host: env.APP_SMTP_HOST,
    port: env.APP_SMTP_PORT,
    secure: env.APP_SMTP_SECURE,
    user: env.APP_SMTP_USER,
    password: env.APP_SMTP_PASSWORD,
    fromEmail: env.APP_SMTP_FROM_EMAIL,
    fromName: env.APP_SMTP_FROM_NAME,
  };
}
