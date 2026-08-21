import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { receivedInvoiceApi, apiErrorMessage } from "../lib/api";
import type { ReceivedInvoice } from "../lib/types";
import { centsToEur, formatDate, formatEur, paymentStatusTone, PAYMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "../lib/format";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { FullPageSpinner } from "../components/ui/Spinner";

export function ReceivedInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<ReceivedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    receivedInvoiceApi
      .get(id)
      .then(setInvoice)
      .catch((err) => setError(apiErrorMessage(err, "Faktúru sa nepodarilo načítať")));
  }, [id]);

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
      const updated = await receivedInvoiceApi.recordPayment(id, Math.round(amountEur * 100));
      setInvoice(updated);
      setPaymentAmount("");
    } catch (err) {
      setPaymentError(apiErrorMessage(err, "Zaznamenanie úhrady zlyhalo"));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm("Naozaj odstrániť túto prijatú faktúru? Táto akcia sa nedá vrátiť späť.")) return;
    try {
      await receivedInvoiceApi.remove(id);
      navigate("/app/received-invoices");
    } catch (err) {
      setError(apiErrorMessage(err, "Odstránenie zlyhalo"));
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!invoice) return <FullPageSpinner />;

  const remainingCents = invoice.grossAmountCents - invoice.paidAmountCents;
  // A received credit note isn't something we owe money on — same rule the backend enforces
  // (receivedInvoiceController.recordReceivedInvoicePayment restricts to documentType INVOICE).
  const canRecordPayment =
    invoice.documentType === "INVOICE" && (invoice.paymentStatus === "UNPAID" || invoice.paymentStatus === "PARTIALLY_PAID");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink-900">
              {DOCUMENT_TYPE_LABELS[invoice.documentType] ?? "Faktúra"} {invoice.number}
            </h1>
            <Badge tone="neutral">Prijatá</Badge>
            <Badge tone={paymentStatusTone(invoice.paymentStatus)}>{PAYMENT_STATUS_LABELS[invoice.paymentStatus] ?? invoice.paymentStatus}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Vystavená {formatDate(invoice.issueDate)}
            {invoice.dueDate && <> · Splatná {formatDate(invoice.dueDate)}</>}
            {invoice.overdue && <span className="ml-1 font-medium text-danger-600">· {invoice.daysOverdue} dní po splatnosti</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.open(receivedInvoiceApi.downloadUrl(invoice.id), "_blank")}>
            Stiahnuť pôvodné XML
          </Button>
          <Button variant="ghost" className="text-danger-600" onClick={handleDelete}>
            Odstrániť
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Overenie" description="Naša kontrola je v ľudskej reči; oficiálna Peppol validácia je doplnková technická vrstva." />
        <CardBody className="flex flex-col gap-4">
          {invoice.ourErrors.length === 0 && invoice.ourWarnings.length === 0 && (
            <Alert tone="success">Naša kontrola nenašla žiadny problém.</Alert>
          )}
          {invoice.ourErrors.length > 0 && (
            <Alert tone="danger" title="Problémy, ktoré treba vyriešiť">
              <ul className="list-disc pl-4">
                {invoice.ourErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          {invoice.ourWarnings.length > 0 && (
            <Alert tone="warning" title="Upozornenia">
              <ul className="list-disc pl-4">
                {invoice.ourWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="border-t border-line pt-4">
            <p className="text-sm font-medium text-ink-900">Oficiálna Peppol/EN16931 validácia (KOSIT)</p>
            {invoice.kositAcceptable === null ? (
              <p className="mt-1 text-sm text-ink-500">
                Nedostupná pre tento dokument {invoice.kositAvailable === false ? "(validátor nie je na serveri nastavený)" : ""}.
              </p>
            ) : (
              <>
                <Badge tone={invoice.kositAcceptable ? "success" : "danger"} >
                  {invoice.kositAcceptable ? "ACCEPTABLE" : "REJECTED"}
                </Badge>
                {invoice.kositMessages.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-xs text-ink-500">
                    {invoice.kositMessages.map((m, i) => (
                      <li key={i} className="font-mono">
                        {m}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </CardBody>
      </Card>

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
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Dodávateľ" />
        <CardBody className="text-sm text-ink-700">
          <p className="font-medium text-ink-900">{invoice.supplierName}</p>
          {invoice.supplierDic && <p>DIČ: {invoice.supplierDic}</p>}
          {invoice.supplierIco && <p>IČO: {invoice.supplierIco}</p>}
          {invoice.supplierIcDph && <p>IČ DPH: {invoice.supplierIcDph}</p>}
          {(invoice.supplierStreet || invoice.supplierCity) && (
            <p>
              {invoice.supplierStreet}
              {invoice.supplierStreet && invoice.supplierCity && ", "}
              {invoice.supplierPostalCode} {invoice.supplierCity}
            </p>
          )}
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
              {invoice.lines.map((line, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">
                    {line.quantity} {line.unitCode}
                  </td>
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

      <Link to="/app/received-invoices" className="text-sm font-medium text-brand-600 hover:text-brand-700">
        ← Späť na prijaté faktúry
      </Link>
    </div>
  );
}
