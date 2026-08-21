import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { invoiceApi, apiErrorMessage } from "../lib/api";
import type { InvoiceDetail, SentEmail } from "../lib/types";
import {
  centsToEur,
  formatDate,
  formatDateTime,
  formatEur,
  invoiceStatusTone,
  INVOICE_STATUS_LABELS,
  paymentStatusTone,
  PAYMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  toLocalIsoDate,
} from "../lib/format";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { FullPageSpinner } from "../components/ui/Spinner";
import { XmlPreview } from "../components/invoice/XmlPreview";

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showCreditNoteForm, setShowCreditNoteForm] = useState(false);
  const [creditNoteNumber, setCreditNoteNumber] = useState("");
  const [creditNoteReason, setCreditNoteReason] = useState("");
  const [creditNoteBusy, setCreditNoteBusy] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState<string | null>(null);

  const [sentEmails, setSentEmails] = useState<SentEmail[] | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSendState, setEmailSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [emailSendMessage, setEmailSendMessage] = useState<string | null>(null);

  const [reminderSendState, setReminderSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [reminderSendMessage, setReminderSendMessage] = useState<string | null>(null);

  function refreshSentEmails() {
    if (!id) return;
    invoiceApi.listSentEmails(id).then(setSentEmails).catch(() => setSentEmails([]));
  }

  useEffect(() => {
    if (!id) return;
    invoiceApi
      .get(id)
      .then(setInvoice)
      .catch((err) => setError(apiErrorMessage(err, "Faktúru sa nepodarilo načítať")));
    refreshSentEmails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSend() {
    if (!id) return;
    setSendState("sending");
    setSendMessage(null);
    try {
      const result = await invoiceApi.sendSapi(id);
      setSendState(result.success ? "sent" : "failed");
      setSendMessage(
        result.success
          ? result.mock
            ? "Simulované odoslanie prebehlo úspešne (MOCK režim)."
            : `Odoslané. ID: ${result.providerDocumentId}`
          : (result.error ?? "Odoslanie zlyhalo")
      );
      const refreshed = await invoiceApi.get(id);
      setInvoice(refreshed);
    } catch (err) {
      setSendState("failed");
      setSendMessage(apiErrorMessage(err));
    }
  }

  async function handleRecordPayment() {
    if (!id) return;
    const amountEur = Number(paymentAmount);
    if (!Number.isFinite(amountEur) || amountEur <= 0) {
      setPaymentError("Zadaj kladnú sumu úhrady.");
      return;
    }
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      const updated = await invoiceApi.recordPayment(id, Math.round(amountEur * 100));
      setInvoice(updated);
      setPaymentAmount("");
    } catch (err) {
      setPaymentError(apiErrorMessage(err, "Zaznamenanie úhrady zlyhalo"));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      const updated = await invoiceApi.cancel(id);
      setInvoice(updated);
    } catch (err) {
      setPaymentError(apiErrorMessage(err, "Stornovanie zlyhalo"));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleCreateCreditNote() {
    if (!id || !creditNoteNumber.trim()) {
      setCreditNoteError("Zadaj číslo dobropisu.");
      return;
    }
    setCreditNoteBusy(true);
    setCreditNoteError(null);
    try {
      const result = await invoiceApi.createCreditNote(id, {
        number: creditNoteNumber.trim(),
        issueDate: toLocalIsoDate(new Date()),
        reason: creditNoteReason.trim() || undefined,
      });
      if (result.success && result.invoiceId) {
        navigate(`/app/invoices/${result.invoiceId}`);
      } else {
        setCreditNoteError(result.errors?.join(" ") ?? "Vytvorenie dobropisu zlyhalo");
      }
    } catch (err) {
      setCreditNoteError(apiErrorMessage(err, "Vytvorenie dobropisu zlyhalo"));
    } finally {
      setCreditNoteBusy(false);
    }
  }

  function handleOpenEmailForm() {
    setEmailTo(invoice?.customerEmail ?? "");
    setEmailSendMessage(null);
    setEmailSendState("idle");
    setShowEmailForm(true);
  }

  async function handleSendEmail() {
    if (!id) return;
    setEmailSendState("sending");
    setEmailSendMessage(null);
    try {
      const result = await invoiceApi.sendEmail(id, emailTo.trim() || undefined);
      setEmailSendState(result.success ? "sent" : "failed");
      setEmailSendMessage(result.success ? "Email odoslaný." : (result.errors?.join(" ") ?? "Odoslanie zlyhalo"));
      if (result.success) {
        setShowEmailForm(false);
        refreshSentEmails();
      }
    } catch (err) {
      setEmailSendState("failed");
      setEmailSendMessage(apiErrorMessage(err));
    }
  }

  async function handleSendReminderNow() {
    if (!id) return;
    setReminderSendState("sending");
    setReminderSendMessage(null);
    try {
      const result = await invoiceApi.sendReminderNow(id);
      setReminderSendState(result.success ? "sent" : "failed");
      setReminderSendMessage(result.success ? "Upomienka odoslaná." : (result.errors?.join(" ") ?? "Odoslanie zlyhalo"));
      if (result.success) refreshSentEmails();
    } catch (err) {
      setReminderSendState("failed");
      setReminderSendMessage(apiErrorMessage(err));
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!invoice) return <FullPageSpinner />;

  const creditedCents = invoice.corrections.reduce((sum, c) => sum + c.grossAmountCents, 0);
  // Credit notes reduce what's still owed the same way a payment does — without this, "Zostáva
  // uhradiť" kept showing the full gross-minus-paid figure even after the invoice had already
  // been credited down (or fully settled via credit alone), which a customer could then overpay.
  const remainingCents = Math.max(0, invoice.grossAmountCents - invoice.paidAmountCents - creditedCents);
  const canRecordPayment = invoice.paymentStatus === "UNPAID" || invoice.paymentStatus === "PARTIALLY_PAID";
  const fullyCredited = creditedCents >= invoice.grossAmountCents;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink-900">
              {DOCUMENT_TYPE_LABELS[invoice.documentType] ?? "Faktúra"} {invoice.number}
            </h1>
            <Badge tone={invoiceStatusTone(invoice.status)}>
              {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
            </Badge>
            {invoice.documentType === "INVOICE" && (
              <Badge tone={paymentStatusTone(invoice.paymentStatus)}>
                {PAYMENT_STATUS_LABELS[invoice.paymentStatus] ?? invoice.paymentStatus}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Vystavená {formatDate(invoice.issueDate)}
            {/* dueDate is a non-meaningful placeholder (= issueDate) for anything but a plain
                invoice — UBL CreditNoteType has no DueDate concept — so don't show a fake one. */}
            {invoice.documentType === "INVOICE" && <> · Splatná {formatDate(invoice.dueDate)}</>}
            {invoice.overdue && <span className="ml-1 font-medium text-danger-600">· {invoice.daysOverdue} dní po splatnosti</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.open(invoiceApi.pdfUrl(invoice.id), "_blank")}>
            Stiahnuť PDF
          </Button>
          <Button variant="secondary" onClick={() => window.open(invoiceApi.downloadUrl(invoice.id), "_blank")}>
            Stiahnuť XML
          </Button>
          <Button variant="secondary" onClick={handleOpenEmailForm}>
            Odoslať emailom
          </Button>
          <Button variant="accent" loading={sendState === "sending"} onClick={handleSend}>
            {invoice.status === "SENT" ? "Odoslať znova" : "Odoslať cez SAPI-SK"}
          </Button>
        </div>
      </div>

      {showEmailForm && (
        <Card>
          <CardHeader title="Odoslať faktúru emailom" description="PDF a XML sa pripoja ako prílohy." />
          <CardBody className="flex flex-col gap-4">
            {emailSendMessage && <Alert tone={emailSendState === "sent" ? "success" : "danger"}>{emailSendMessage}</Alert>}
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Email odberateľa"
                type="email"
                required
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="max-w-xs"
              />
              <Button variant="accent" loading={emailSendState === "sending"} onClick={handleSendEmail}>
                Odoslať
              </Button>
              <Button variant="ghost" onClick={() => setShowEmailForm(false)}>
                Zrušiť
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {sendMessage && <Alert tone={sendState === "sent" ? "success" : "danger"}>{sendMessage}</Alert>}

      {invoice.documentType === "INVOICE" && (
        <Card>
          <CardHeader
            title="Úhrada"
            description={`Uhradené ${formatEur(centsToEur(invoice.paidAmountCents))} z ${formatEur(centsToEur(invoice.grossAmountCents))}${
              invoice.paidAt ? ` · uhradené ${formatDate(invoice.paidAt)}` : ""
            }`}
          />
          <CardBody className="flex flex-col gap-4">
            {paymentError && <Alert tone="danger">{paymentError}</Alert>}
            {reminderSendMessage && <Alert tone={reminderSendState === "sent" ? "success" : "danger"}>{reminderSendMessage}</Alert>}
            {canRecordPayment && (
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label="Zaznamenať úhradu (€)"
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  hint={`Zostáva uhradiť ${formatEur(centsToEur(remainingCents))}`}
                  className="max-w-[220px]"
                />
                <Button variant="secondary" loading={paymentBusy} onClick={handleRecordPayment}>
                  Zaznamenať úhradu
                </Button>
                <Button variant="secondary" loading={reminderSendState === "sending"} onClick={handleSendReminderNow}>
                  Poslať upomienku teraz
                </Button>
                <Button variant="ghost" loading={paymentBusy} onClick={handleCancel} className="ml-auto text-danger-600">
                  Stornovať faktúru
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {invoice.documentType === "CREDIT_NOTE" && invoice.original && (
        <Alert tone="info">
          Dobropis k faktúre{" "}
          <Link to={`/app/invoices/${invoice.original.id}`} className="font-medium underline">
            {invoice.original.number}
          </Link>
        </Alert>
      )}

      {invoice.documentType === "INVOICE" && (
        <Card>
          <CardHeader title="Dobropisy" description="Opravy alebo storná tejto faktúry." />
          <CardBody className="flex flex-col gap-4">
            {invoice.corrections.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {invoice.corrections.map((c) => (
                  <li key={c.id}>
                    <Link to={`/app/invoices/${c.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                      {c.number}
                    </Link>{" "}
                    · {formatDate(c.issueDate)} · {formatEur(centsToEur(c.grossAmountCents))}
                  </li>
                ))}
              </ul>
            )}

            {creditNoteError && <Alert tone="danger">{creditNoteError}</Alert>}

            {invoice.paymentStatus !== "CANCELLED" && fullyCredited && (
              <p className="text-sm text-ink-500">Faktúra je už dobropisovaná v plnej výške.</p>
            )}

            {invoice.paymentStatus !== "CANCELLED" &&
              !fullyCredited &&
              (showCreditNoteForm ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Input label="Číslo dobropisu" value={creditNoteNumber} onChange={(e) => setCreditNoteNumber(e.target.value)} className="max-w-[180px]" />
                  <Input label="Dôvod (voliteľné)" value={creditNoteReason} onChange={(e) => setCreditNoteReason(e.target.value)} className="max-w-xs" />
                  <Button variant="secondary" loading={creditNoteBusy} onClick={handleCreateCreditNote}>
                    Vystaviť dobropis (celá suma)
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCreditNoteForm(false)}>
                    Zrušiť
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setShowCreditNoteForm(true)} className="self-start">
                  + Vystaviť dobropis
                </Button>
              ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Odberateľ" />
        <CardBody className="text-sm text-ink-700">
          <p className="font-medium text-ink-900">{invoice.customerName}</p>
          <p>DIČ: {invoice.customerDic}</p>
          {invoice.customerEmail && <p>Email: {invoice.customerEmail}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Položky" />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                <th className="py-2">Popis</th>
                <th className="py-2 text-right">Množstvo</th>
                <th className="py-2 text-right">Jedn. cena</th>
                <th className="py-2 text-right">DPH</th>
                <th className="py-2 text-right">Spolu bez DPH</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{formatEur(centsToEur(line.unitPriceCents))}</td>
                  <td className="py-2 text-right">{line.taxRatePercent} %</td>
                  <td className="py-2 text-right font-mono tabular-nums">{formatEur(centsToEur(line.lineNetCents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <div className="w-64 text-sm">
              <div className="flex justify-between py-1 text-ink-500">
                <span>Bez DPH</span>
                <span className="font-mono">{formatEur(centsToEur(invoice.netAmountCents))}</span>
              </div>
              <div className="flex justify-between py-1 text-ink-500">
                <span>DPH</span>
                <span className="font-mono">{formatEur(centsToEur(invoice.taxAmountCents))}</span>
              </div>
              <div className="flex justify-between border-t border-line py-1.5 font-semibold text-ink-900">
                <span>Spolu</span>
                <span className="font-mono">{formatEur(centsToEur(invoice.grossAmountCents))}</span>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {sentEmails && sentEmails.length > 0 && (
        <Card>
          <CardHeader title="Odoslané emaily" />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                  <th className="py-2">Typ</th>
                  <th className="py-2">Komu</th>
                  <th className="py-2">Predmet</th>
                  <th className="py-2">Stav</th>
                  <th className="py-2">Kedy</th>
                </tr>
              </thead>
              <tbody>
                {sentEmails.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="py-2">
                      {e.type === "REMINDER" ? (e.reminderNumber ? `Upomienka č. ${e.reminderNumber}` : "Upomienka (manuálna)") : "Faktúra"}
                    </td>
                    <td className="py-2">{e.toEmail || "—"}</td>
                    <td className="py-2">{e.subject}</td>
                    <td className="py-2">
                      <Badge tone={e.status === "SENT" ? "success" : "danger"}>{e.status === "SENT" ? "Odoslané" : "Zlyhalo"}</Badge>
                    </td>
                    <td className="py-2 text-ink-500">{formatDateTime(e.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {invoice.xml && (
        <Card>
          <CardHeader title="UBL XML" />
          <CardBody>
            <XmlPreview xml={invoice.xml} />
          </CardBody>
        </Card>
      )}

      <Link to="/app/invoices" className="text-sm font-medium text-brand-600 hover:text-brand-700">
        ← Späť na históriu
      </Link>
    </div>
  );
}
