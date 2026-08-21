import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { sendEmail, type SmtpConfig } from "./emailSender";

/**
 * A real local SMTP server (not a mock of nodemailer) — the strongest verification available
 * without an actual mailbox: it exercises the real SMTP protocol handshake, auth, and MIME
 * message construction (subject/body/attachments/recipient), the same way paymentQr.test.ts
 * decodes a real rendered QR image instead of just checking the pre-render string.
 */
let server: SMTPServer;
let port: number;
let received: ParsedMail[] = [];
let authAttempts: { username?: string; password?: string }[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      authAttempts.push({ username: auth.username, password: auth.password });
      callback(null, { user: auth.username });
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        simpleParser(Buffer.concat(chunks))
          .then((parsed) => {
            received.push(parsed);
            callback();
          })
          .catch((err) => callback(err));
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const address = server.server.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function smtp(overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: "127.0.0.1",
    port,
    secure: false,
    user: "test@example.com",
    password: "secret",
    fromEmail: "faktury@mojafirma.sk",
    fromName: "Moja Firma s.r.o.",
    ...overrides,
  };
}

describe("sendEmail", () => {
  beforeAll(() => {
    received = [];
    authAttempts = [];
  });

  it("delivers a real SMTP message with the correct sender, recipient, subject, body, and auth credentials", async () => {
    const result = await sendEmail({
      smtp: smtp(),
      to: "odberatel@example.com",
      subject: "Faktúra 2026-0001",
      text: "V prílohe posielame faktúru na sumu 123,00 €.",
    });

    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg.subject).toBe("Faktúra 2026-0001");
    expect(msg.text?.trim()).toBe("V prílohe posielame faktúru na sumu 123,00 €.");
    expect(msg.to && "value" in msg.to ? msg.to.value[0].address : undefined).toBe("odberatel@example.com");
    expect(msg.from?.value[0].address).toBe("faktury@mojafirma.sk");
    expect(msg.from?.value[0].name).toBe("Moja Firma s.r.o.");
    expect(authAttempts.at(-1)).toEqual({ username: "test@example.com", password: "secret" });
  });

  it("delivers real PDF and XML attachments with correct filenames and content types", async () => {
    const pdfBytes = Buffer.from("%PDF-1.7 fake pdf content");
    const xmlBytes = Buffer.from("<Invoice><cbc:ID>2026-0002</cbc:ID></Invoice>", "utf8");

    await sendEmail({
      smtp: smtp(),
      to: "odberatel@example.com",
      subject: "Faktúra 2026-0002",
      text: "text",
      attachments: [
        { filename: "faktura_2026-0002.pdf", content: pdfBytes, contentType: "application/pdf" },
        { filename: "faktura_2026-0002.xml", content: xmlBytes, contentType: "application/xml" },
      ],
    });

    const msg = received.at(-1)!;
    expect(msg.attachments).toHaveLength(2);
    const pdf = msg.attachments.find((a) => a.filename === "faktura_2026-0002.pdf");
    const xml = msg.attachments.find((a) => a.filename === "faktura_2026-0002.xml");
    expect(pdf?.content.toString()).toBe("%PDF-1.7 fake pdf content");
    expect(pdf?.contentType).toBe("application/pdf");
    expect(xml?.content.toString("utf8")).toBe("<Invoice><cbc:ID>2026-0002</cbc:ID></Invoice>");
  });

  it("returns success: false with a message instead of throwing when the SMTP server is unreachable", async () => {
    const result = await sendEmail({
      smtp: smtp({ port: 1 }), // nothing listens on port 1
      to: "odberatel@example.com",
      subject: "x",
      text: "x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("delivers a fromName containing a quote character correctly instead of producing a malformed From header", async () => {
    // regression: building the header via a hand-written `"${fromName}" <${fromEmail}>` string
    // breaks RFC 5322 quoted-string syntax the moment fromName itself contains a `"`.
    const result = await sendEmail({
      smtp: smtp({ fromName: 'Reštaurácia "U Podkovy" s.r.o.' }),
      to: "odberatel@example.com",
      subject: "x",
      text: "x",
    });
    expect(result.success).toBe(true);
    const msg = received.at(-1)!;
    expect(msg.from?.value[0].name).toBe('Reštaurácia "U Podkovy" s.r.o.');
    expect(msg.from?.value[0].address).toBe("faktury@mojafirma.sk");
  });
});
