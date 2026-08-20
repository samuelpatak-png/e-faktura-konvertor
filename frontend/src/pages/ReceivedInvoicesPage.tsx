import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { receivedInvoiceApi, apiErrorMessage } from "../lib/api";
import type { ReceivedInvoice } from "../lib/types";
import { formatDate, formatEur, paymentStatusTone, PAYMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { Spinner } from "../components/ui/Spinner";

export function ReceivedInvoicesPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<ReceivedInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function load() {
    receivedInvoiceApi
      .list()
      .then(setInvoices)
      .catch((err) => setError(apiErrorMessage(err, "Nepodarilo sa načítať prijaté faktúry")));
  }

  useEffect(load, []);

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      await receivedInvoiceApi.upload(file);
      load();
    } catch (err) {
      setUploadError(apiErrorMessage(err, "Nepodarilo sa spracovať XML súbor"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Prijaté faktúry</h1>
        <p className="mt-1 text-sm text-ink-500">Nahraj UBL XML faktúru alebo dobropis od dodávateľa — overíme a zobrazíme čitateľne.</p>
      </div>

      <div
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-canvas px-6 py-8 text-center transition-colors hover:border-brand-400"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <svg className="h-8 w-8 text-ink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l-3.5 3.5M12 9.75l3.5 3.5M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
        </svg>
        <p className="text-sm text-ink-700">
          <span className="font-medium text-brand-600">Klikni pre výber</span> alebo presuň UBL XML sem
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {uploading && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Spinner className="h-4 w-4 text-brand-600" /> Spracúvam a overujem XML…
        </div>
      )}
      {uploadError && <Alert tone="danger">{uploadError}</Alert>}

      {!invoices ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : invoices.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-500">Zatiaľ nemáš žiadne prijaté faktúry.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3">Číslo</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Dodávateľ</th>
                <th className="px-4 py-3">Vystavená</th>
                <th className="px-4 py-3 text-right">Suma</th>
                <th className="px-4 py-3">Overenie</th>
                <th className="px-4 py-3">Úhrada</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link to={`/app/received-invoices/${inv.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                      {inv.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{DOCUMENT_TYPE_LABELS[inv.documentType] ?? inv.documentType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{inv.supplierName}</td>
                  <td className="px-4 py-3 text-ink-700">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-900">{formatEur(inv.grossAmount)}</td>
                  <td className="px-4 py-3">
                    {inv.ourErrors.length > 0 ? (
                      <Badge tone="danger">{inv.ourErrors.length} chýb</Badge>
                    ) : inv.kositAcceptable === false ? (
                      <Badge tone="warning">Peppol: nevyhovuje</Badge>
                    ) : inv.kositAcceptable === true ? (
                      <Badge tone="success">V poriadku</Badge>
                    ) : (
                      <Badge tone="neutral">Neoverené</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={paymentStatusTone(inv.paymentStatus)}>{PAYMENT_STATUS_LABELS[inv.paymentStatus] ?? inv.paymentStatus}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
