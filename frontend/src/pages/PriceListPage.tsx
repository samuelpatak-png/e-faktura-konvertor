import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { priceListApi, apiErrorMessage } from "../lib/api";
import type { PriceListItem } from "../lib/types";
import { formatEur } from "../lib/format";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";

const PAGE_SIZE = 20;

export function PriceListPage() {
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<{ items: PriceListItem[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      priceListApi
        .list({ q: q.trim() || undefined, page, pageSize: PAGE_SIZE, includeInactive })
        .then((res) => {
          if (!cancelled) setResult(res);
        })
        .catch((err) => {
          if (!cancelled) setError(apiErrorMessage(err, "Nepodarilo sa načítať cenník"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, page, includeInactive]);

  async function handleToggleActive(item: PriceListItem) {
    setActionError(null);
    try {
      if (item.isActive) {
        await priceListApi.remove(item.id);
      } else {
        await priceListApi.update(item.id, { ...item, isActive: true });
      }
      setResult((prev) =>
        prev
          ? {
              ...prev,
              items: includeInactive
                ? prev.items.map((i) => (i.id === item.id ? { ...i, isActive: !i.isActive } : i))
                : prev.items.filter((i) => i.id !== item.id),
            }
          : prev
      );
    } catch (err) {
      setActionError(apiErrorMessage(err, "Akciu sa nepodarilo vykonať"));
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Cenník</h1>
          <p className="mt-1 text-sm text-ink-500">Položky na rýchle pridanie do faktúry.</p>
        </div>
        <Link to="/app/price-list/new">
          <Button>+ Nová položka</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Input
          label="Hľadať"
          placeholder="Názov alebo SKU..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              setPage(1);
            }}
          />
          Zobraziť aj neaktívne
        </label>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {loading && !result ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : result && result.items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-500">
          {q ? "Žiadna položka nezodpovedá hľadaniu." : "Zatiaľ nemáš žiadne položky v cenníku."}
        </Card>
      ) : result ? (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3">Názov</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Cena / MJ</th>
                  <th className="px-4 py-3">DPH</th>
                  <th className="px-4 py-3">Stav</th>
                  <th className="px-4 py-3 text-right">Akcie</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link to={`/app/price-list/${item.id}`} className="font-medium text-brand-600 hover:text-brand-700">
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{item.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-900">
                      {formatEur(item.unitPrice)} / {item.unitCode}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{item.vatRate} %</td>
                    <td className="px-4 py-3">
                      <Badge tone={item.isActive ? "success" : "neutral"}>{item.isActive ? "Aktívna" : "Neaktívna"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)}>
                        {item.isActive ? "Deaktivovať" : "Aktivovať"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-ink-500">
              <span>
                Strana {page} z {totalPages} ({result.total} položiek)
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Predchádzajúca
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Ďalšia
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
