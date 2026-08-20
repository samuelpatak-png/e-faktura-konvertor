import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoiceApi, apiErrorMessage } from "../lib/api";
import type { UnpaidSummary } from "../lib/types";
import { centsToEur, formatEur } from "../lib/format";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";

const BUCKET_LABELS: { key: keyof UnpaidSummary["buckets"]; label: string }[] = [
  { key: "notYetDue", label: "Ešte nesplatné" },
  { key: "days0to30", label: "0–30 dní po splatnosti" },
  { key: "days31to60", label: "31–60 dní po splatnosti" },
  { key: "days60plus", label: "60+ dní po splatnosti" },
];

export function UnpaidPage() {
  const [summary, setSummary] = useState<UnpaidSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoiceApi
      .unpaidSummary()
      .then(setSummary)
      .catch((err) => setError(apiErrorMessage(err, "Nepodarilo sa načítať prehľad pohľadávok")));
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!summary) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Neuhradené faktúry</h1>
        <p className="mt-1 text-sm text-ink-500">Prehľad otvorených pohľadávok podľa veku.</p>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-8">
          <div>
            <p className="text-sm text-ink-500">Celkové pohľadávky</p>
            <p className="text-3xl font-semibold text-ink-900">{formatEur(centsToEur(summary.totalOutstandingCents))}</p>
          </div>
          <div>
            <p className="text-sm text-ink-500">Počet faktúr</p>
            <p className="text-3xl font-semibold text-ink-900">{summary.count}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rozdelenie podľa veku" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUCKET_LABELS.map(({ key, label }) => {
            const bucket = summary.buckets[key];
            const isOverdueBucket = key !== "notYetDue";
            return (
              <div key={key} className="rounded-xl border border-line p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
                <p className={`mt-1 text-xl font-semibold ${isOverdueBucket && bucket.count > 0 ? "text-danger-600" : "text-ink-900"}`}>
                  {formatEur(centsToEur(bucket.amountCents))}
                </p>
                <p className="text-sm text-ink-500">{bucket.count} faktúr</p>
              </div>
            );
          })}
        </CardBody>
      </Card>

      {summary.count === 0 && (
        <Card className="p-8 text-center text-sm text-ink-500">Žiadne neuhradené faktúry — všetko je vyrovnané.</Card>
      )}

      <Link to="/app/invoices" className="text-sm font-medium text-brand-600 hover:text-brand-700">
        ← Späť na históriu
      </Link>
    </div>
  );
}
