import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoiceApi, apiErrorMessage } from "../lib/api";
import type { InvoiceListItem } from "../lib/types";
import { formatDate, formatEur, invoiceStatusTone, INVOICE_STATUS_LABELS } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";

export function InvoiceHistoryPage() {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoiceApi
      .list()
      .then(setInvoices)
      .catch((err) => setError(apiErrorMessage(err, "Nepodarilo sa načítať faktúry")));
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!invoices) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">História faktúr</h1>
          <p className="mt-1 text-sm text-ink-500">{invoices.length} vygenerovaných faktúr</p>
        </div>
        <Link to="/app/new">
          <Button>+ Nová faktúra</Button>
        </Link>
      </div>

      {invoices.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-500">Zatiaľ nemáš žiadne vygenerované faktúry.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3">Číslo</th>
                <th className="px-4 py-3">Odberateľ</th>
                <th className="px-4 py-3">Vystavená</th>
                <th className="px-4 py-3">Splatnosť</th>
                <th className="px-4 py-3 text-right">Suma</th>
                <th className="px-4 py-3">Stav</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link to={`/app/invoices/${inv.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                      {inv.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{inv.customerName}</td>
                  <td className="px-4 py-3 text-ink-700">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-ink-700">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-900">{formatEur(inv.grossAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={invoiceStatusTone(inv.status)}>{INVOICE_STATUS_LABELS[inv.status] ?? inv.status}</Badge>
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
