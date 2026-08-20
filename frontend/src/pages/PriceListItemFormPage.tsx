import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { priceListApi, apiErrorMessage } from "../lib/api";
import type { PriceListItemInput } from "../lib/types";
import { UNIT_CODES, VAT_RATES, type VatRate } from "../lib/types";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";

const EMPTY: PriceListItemInput = {
  name: "",
  description: null,
  unitCode: "C62",
  unitPrice: 0,
  vatRate: 23,
  sku: null,
};

export function PriceListItemFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<PriceListItemInput>(EMPTY);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    priceListApi
      .get(id)
      .then((item) => {
        setForm({
          name: item.name,
          description: item.description,
          unitCode: item.unitCode,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          sku: item.sku,
        });
        setIsActive(item.isActive);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, "Položku sa nepodarilo načítať")))
      .finally(() => setLoading(false));
  }, [id]);

  function update<K extends keyof PriceListItemInput>(key: K, value: PriceListItemInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && id) {
        await priceListApi.update(id, { ...form, isActive });
      } else {
        await priceListApi.create(form);
      }
      navigate("/app/price-list");
    } catch (err) {
      setSaveError(apiErrorMessage(err, "Uloženie zlyhalo"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!id) return;
    setSaving(true);
    try {
      await priceListApi.remove(id);
      navigate("/app/price-list");
    } catch (err) {
      setSaveError(apiErrorMessage(err, "Deaktivácia zlyhala"));
      setSaving(false);
    }
  }

  if (loading) return <FullPageSpinner />;
  if (loadError) return <Alert tone="danger">{loadError}</Alert>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink-900">{isEdit ? "Upraviť položku" : "Nová položka cenníka"}</h1>

      <Card>
        <CardHeader title="Položka" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Názov" required className="sm:col-span-2" value={form.name} onChange={(e) => update("name", e.target.value)} />
          <Input
            label="Popis"
            className="sm:col-span-2"
            value={form.description ?? ""}
            onChange={(e) => update("description", e.target.value || null)}
          />
          <Input label="SKU" value={form.sku ?? ""} onChange={(e) => update("sku", e.target.value || null)} />
          <Select label="Merná jednotka" value={form.unitCode} onChange={(e) => update("unitCode", e.target.value)}>
            {UNIT_CODES.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label} ({u.code})
              </option>
            ))}
          </Select>
          <Input
            label="Jednotková cena (€)"
            type="number"
            required
            min={0}
            step="0.01"
            value={form.unitPrice}
            onChange={(e) => update("unitPrice", Number(e.target.value))}
          />
          <Select label="DPH" value={form.vatRate} onChange={(e) => update("vatRate", Number(e.target.value) as VatRate)}>
            {VAT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate} %
              </option>
            ))}
          </Select>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Aktívna
            </label>
          )}
        </CardBody>
      </Card>

      {saveError && <Alert tone="danger">{saveError}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" loading={saving} disabled={!form.name} onClick={handleSubmit}>
          {isEdit ? "Uložiť zmeny" : "Vytvoriť položku"}
        </Button>
        <Button variant="secondary" onClick={() => navigate("/app/price-list")}>
          Zrušiť
        </Button>
        {isEdit && isActive && (
          <Button variant="danger" className="ml-auto" onClick={handleDeactivate} loading={saving}>
            Deaktivovať
          </Button>
        )}
      </div>
    </div>
  );
}
