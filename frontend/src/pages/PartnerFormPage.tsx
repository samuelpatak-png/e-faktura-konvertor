import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { partnerApi, apiErrorMessage } from "../lib/api";
import type { PartnerInput } from "../lib/types";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";

const EMPTY: PartnerInput = {
  name: "",
  ico: null,
  dic: "",
  icDph: null,
  street: "",
  city: "",
  postalCode: "",
  countryCode: "SK",
  peppolScheme: null,
  peppolId: null,
  email: null,
  note: null,
  category: null,
};

export function PartnerFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<PartnerInput>(EMPTY);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not-found" | "unavailable">("idle");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    partnerApi
      .get(id)
      .then((p) => {
        const { isActive: active, id: _id, createdAt: _c, updatedAt: _u, ...rest } = p;
        setForm(rest);
        setIsActive(active);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, "Odberateľa sa nepodarilo načítať")))
      .finally(() => setLoading(false));
  }, [id]);

  function update<K extends keyof PartnerInput>(key: K, value: PartnerInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleLookup() {
    if (!form.ico || !/^\d{8}$/.test(form.ico)) return;
    setLookupState("loading");
    try {
      const result = await partnerApi.lookupByIco(form.ico);
      if (!result.found || !result.data) {
        setLookupState("not-found");
        return;
      }
      setLookupState("idle");
      // Only fill fields that are still empty — never clobber what the user already typed.
      setForm((f) => ({
        ...f,
        name: f.name || result.data!.name,
        street: f.street || result.data!.street || f.street,
        city: f.city || result.data!.city || f.city,
        postalCode: f.postalCode || result.data!.postalCode || f.postalCode,
      }));
    } catch {
      setLookupState("unavailable");
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && id) {
        await partnerApi.update(id, { ...form, isActive });
      } else {
        await partnerApi.create(form);
      }
      navigate("/app/partners");
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
      await partnerApi.remove(id);
      navigate("/app/partners");
    } catch (err) {
      setSaveError(apiErrorMessage(err, "Deaktivácia zlyhala"));
      setSaving(false);
    }
  }

  if (loading) return <FullPageSpinner />;
  if (loadError) return <Alert tone="danger">{loadError}</Alert>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink-900">{isEdit ? "Upraviť odberateľa" : "Nový odberateľ"}</h1>

      <Card>
        <CardHeader title="Firma" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Názov firmy"
            required
            className="sm:col-span-2"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
          <div className="flex items-end gap-2">
            <Input label="IČO" value={form.ico ?? ""} onChange={(e) => update("ico", e.target.value || null)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleLookup} loading={lookupState === "loading"}>
              Nájsť podľa IČO
            </Button>
          </div>
          <Input
            label="DIČ"
            required
            hint="Peppol participant ID (0245)"
            value={form.dic}
            onChange={(e) => update("dic", e.target.value)}
          />
          <Input label="IČ DPH" value={form.icDph ?? ""} onChange={(e) => update("icDph", e.target.value || null)} />
          <Input label="Email" type="email" value={form.email ?? ""} onChange={(e) => update("email", e.target.value || null)} />
          {lookupState === "not-found" && (
            <p className="sm:col-span-2 text-sm text-ink-500">Firma s týmto IČO sa v registri nenašla — vyplň údaje ručne.</p>
          )}
          {lookupState === "unavailable" && (
            <p className="sm:col-span-2 text-sm text-ink-500">
              Vyhľadávanie podľa IČO je momentálne nedostupné (neoverené externé API) — vyplň údaje ručne.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Adresa" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Ulica a číslo" required className="sm:col-span-2" value={form.street} onChange={(e) => update("street", e.target.value)} />
          <Input label="Mesto" required value={form.city} onChange={(e) => update("city", e.target.value)} />
          <Input label="PSČ" required value={form.postalCode} onChange={(e) => update("postalCode", e.target.value)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Ostatné" description="Voliteľné poznámky pre interné použitie." />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Kategória" value={form.category ?? ""} onChange={(e) => update("category", e.target.value || null)} />
          <Input label="Poznámka" value={form.note ?? ""} onChange={(e) => update("note", e.target.value || null)} />
          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Aktívny
            </label>
          )}
        </CardBody>
      </Card>

      {saveError && <Alert tone="danger">{saveError}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          loading={saving}
          disabled={!form.name || !form.dic || !form.street || !form.city || !form.postalCode}
          onClick={handleSubmit}
        >
          {isEdit ? "Uložiť zmeny" : "Vytvoriť odberateľa"}
        </Button>
        <Button variant="secondary" onClick={() => navigate("/app/partners")}>
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
