import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendEmailInput {
  smtp: SmtpConfig;
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Thin wrapper around nodemailer so callers (controllers, the reminder scheduler) depend on a
 * narrow interface instead of nodemailer's own API — the only thing that changes if we ever
 * swap the transport is this file.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // Everything that can throw — including transport construction itself — lives inside the try
  // block, matching the "must never throw into the caller" contract below: a bad host/port
  // value or any other synchronous failure must come back as {success:false}, not an exception.
  let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    transporter = nodemailer.createTransport({
      host: input.smtp.host,
      port: input.smtp.port,
      secure: input.smtp.secure,
      auth: { user: input.smtp.user, pass: input.smtp.password },
    });
    await transporter.sendMail({
      // A structured {name, address} object (not a hand-built `"name" <addr>` string) so
      // nodemailer escapes a quote or backslash embedded in fromName correctly instead of
      // producing a malformed RFC 5322 header.
      from: { name: input.smtp.fromName, address: input.smtp.fromEmail },
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { success: true };
  } catch (err) {
    // SMTP auth failures, connection refused, etc. must never throw into the caller — a failed
    // send is a normal, expected outcome to record (SentEmail.status = FAILED), not a crash.
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transporter?.close();
  }
}
