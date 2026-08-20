import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { invoiceApi, apiErrorMessage } from "../lib/api";
import type { InvoiceDetail } from "../lib/types";
import {
  centsToEur,
  formatDate,
  formatEur,
  invoiceStatusTone,
  INVOICE_STATUS_LABELS,
  paymentStatusTone,
  PAYMENT_STATUS_LABELS,
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
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    invoiceApi
      .get(id)
      .then(setInvoice)
      .catch((err) => setError(apiErrorMessage(err, "Faktúru sa nepodarilo načítať")));
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

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!invoice) return <FullPageSpinner />;

  const remainingCents = invoice.grossAmountCents - invoice.paidAmountCents;
  const canRecordPayment = invoice.paymentStatus === "UNPAID" || invoice.paymentStatus === "PARTIALLY_PAID";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink-900">Faktúra {invoice.number}</h1>
            <Badge tone={invoiceStatusTone(invoice.status)}>
              {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
            </Badge>
            <Badge tone={paymentStatusTone(invoice.paymentStatus)}>
              {PAYMENT_STATUS_LABELS[invoice.paymentStatus] ?? invoice.paymentStatus}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Vystavená {formatDate(invoice.issueDate)} · Splatná {formatDate(invoice.dueDate)}
            {invoice.overdue && <span className="ml-1 font-medium text-danger-600">· {invoice.daysOverdue} dní po splatnosti</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.open(invoiceApi.downloadUrl(invoice.id), "_blank")}>
            Stiahnuť XML
          </Button>
          <Button variant="accent" loading={sendState === "sending"} onClick={handleSend}>
            {invoice.status === "SENT" ? "Odoslať znova" : "Odoslať cez SAPI-SK"}
          </Button>
        </div>
      </div>

      {sendMessage && <Alert tone={sendState === "sent" ? "success" : "danger"}>{sendMessage}</Alert>}

      <Card>
        <CardHeader
          title="Úhrada"
          description={`Uhradené ${formatEur(centsToEur(invoice.paidAmountCents))} z ${formatEur(centsToEur(invoice.grossAmountCents))}${
            invoice.paidAt ? ` · uhradené ${formatDate(invoice.paidAt)}` : ""
          }`}
        />
        <CardBody className="flex flex-col gap-4">
          {paymentError && <Alert tone="danger">{paymentError}</Alert>}
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
              <Button variant="ghost" loading={paymentBusy} onClick={handleCancel} className="ml-auto text-danger-600">
                Stornovať faktúru
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Odberateľ" />
        <CardBody className="text-sm text-ink-700">
          <p className="font-medium text-ink-900">{invoice.customerName}</p>
          <p>DIČ: {invoice.customerDic}</p>
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
