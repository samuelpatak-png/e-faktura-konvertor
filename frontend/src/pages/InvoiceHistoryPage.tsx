import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { invoiceApi, apiErrorMessage } from "../lib/api";
import type { InvoiceListItem, PaymentStatus } from "../lib/types";
import { formatDate, formatEur, invoiceStatusTone, INVOICE_STATUS_LABELS, paymentStatusTone, PAYMENT_STATUS_LABELS } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Input";

const PAYMENT_FILTER_OPTIONS: { value: PaymentStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Všetky stavy" },
  { value: "UNPAID", label: "Neuhradené" },
  { value: "PARTIALLY_PAID", label: "Čiastočne uhradené" },
  { value: "PAID", label: "Uhradené" },
  { value: "CANCELLED", label: "Stornované" },
];

export function InvoiceHistoryPage() {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | "ALL">("ALL");

  useEffect(() => {
    invoiceApi
      .list()
      .then(setInvoices)
      .catch((err) => setError(apiErrorMessage(err, "Nepodarilo sa načítať faktúry")));
  }, []);

  const filtered = useMemo(() => {
    if (!invoices) return null;
    return paymentFilter === "ALL" ? invoices : invoices.filter((inv) => inv.paymentStatus === paymentFilter);
  }, [invoices, paymentFilter]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!invoices || !filtered) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">História faktúr</h1>
          <p className="mt-1 text-sm text-ink-500">{invoices.length} vygenerovaných faktúr</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/app/invoices/unpaid" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Neuhradené →
          </Link>
          <Link to="/app/new">
            <Button>+ Nová faktúra</Button>
          </Link>
        </div>
      </div>

      <Select label="Stav úhrady" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as PaymentStatus | "ALL")} className="max-w-xs">
        {PAYMENT_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-500">
          {invoices.length === 0 ? "Zatiaľ nemáš žiadne vygenerované faktúry." : "Žiadna faktúra nezodpovedá filtru."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3">Číslo</th>
                <th className="px-4 py-3">Odberateľ</th>
                <th className="px-4 py-3">Vystavená</th>
                <th className="px-4 py-3">Splatnosť</th>
                <th className="px-4 py-3">Po splatnosti</th>
                <th className="px-4 py-3 text-right">Suma</th>
                <th className="px-4 py-3">Stav dokladu</th>
                <th className="px-4 py-3">Úhrada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link to={`/app/invoices/${inv.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                      {inv.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{inv.customerName}</td>
                  <td className="px-4 py-3 text-ink-700">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-3 text-ink-700">{formatDate(inv.dueDate)}</td>
                  <td className="px-4 py-3">
                    {inv.overdue ? <span className="font-medium text-danger-600">{inv.daysOverdue} dní</span> : <span className="text-ink-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-900">{formatEur(inv.grossAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={invoiceStatusTone(inv.status)}>{INVOICE_STATUS_LABELS[inv.status] ?? inv.status}</Badge>
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
