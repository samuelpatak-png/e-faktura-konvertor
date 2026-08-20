import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { companyApi, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BrandingAsset, CompanyBrandingStatus, CompanyProfileInput, SapiSkStatus } from "../lib/types";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { FullPageSpinner } from "../components/ui/Spinner";

const EMPTY_BRANDING: CompanyBrandingStatus = { logo: false, stamp: false, signature: false };

const BRANDING_ROWS: { asset: BrandingAsset; label: string; hint: string }[] = [
  { asset: "logo", label: "Logo", hint: "Zobrazí sa v hlavičke PDF faktúry." },
  { asset: "stamp", label: "Pečiatka", hint: "Zobrazí sa v päte PDF faktúry." },
  { asset: "signature", label: "Podpis", hint: "Zobrazí sa v päte PDF faktúry." },
];

function BrandingAssetRow({
  asset,
  label,
  hint,
  present,
  version,
  uploading,
  onUpload,
  onRemove,
}: {
  asset: BrandingAsset;
  label: string;
  hint: string;
  present: boolean;
  version: number;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-line bg-canvas">
          {present ? (
            <img src={`${companyApi.brandingAssetUrl(asset)}?v=${version}`} alt={label} className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-ink-400">Žiadny</span>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-ink-900">{label}</p>
          <p className="text-xs text-ink-500">{hint}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
          Nahrať
        </Button>
        {present && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Odstrániť
          </Button>
        )}
      </div>
    </div>
  );
}

const EMPTY_PROFILE: CompanyProfileInput = {
  name: "",
  ico: "",
  dic: "",
  icDph: null,
  street: "",
  city: "",
  postalCode: "",
  country: "SK",
  iban: "",
  bic: null,
};

export function SettingsPage() {
  const { refresh } = useAuth();
  const location = useLocation();
  const reason = (location.state as { reason?: string } | null)?.reason;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CompanyProfileInput>(EMPTY_PROFILE);
  const [hasProfile, setHasProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [branding, setBranding] = useState<CompanyBrandingStatus>(EMPTY_BRANDING);
  const [brandingVersion, setBrandingVersion] = useState(0);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState<BrandingAsset | null>(null);

  const [sapiStatus, setSapiStatus] = useState<SapiSkStatus>({ configured: false, mode: "mock" });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [sapiError, setSapiError] = useState<string | null>(null);
  const [savingSapi, setSavingSapi] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  useEffect(() => {
    Promise.all([companyApi.getProfile(), companyApi.getSapiStatus()])
      .then(([p, s]) => {
        if (p) {
          setProfile(p);
          setHasProfile(true);
          setBranding({ logo: p.logo, stamp: p.stamp, signature: p.signature });
        }
        setSapiStatus(s);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);
    setSavingProfile(true);
    try {
      const saved = await companyApi.saveProfile(profile);
      setProfile(saved);
      setHasProfile(true);
      setProfileSaved(true);
      await refresh();
    } catch (err) {
      setProfileError(apiErrorMessage(err, "Nepodarilo sa uložiť údaje o firme"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleBrandingUpload(asset: BrandingAsset, file: File) {
    setBrandingError(null);
    setUploadingAsset(asset);
    try {
      const status = await companyApi.uploadBranding(asset, file);
      setBranding(status);
      setBrandingVersion((v) => v + 1);
    } catch (err) {
      setBrandingError(apiErrorMessage(err, "Nepodarilo sa nahrať súbor"));
    } finally {
      setUploadingAsset(null);
    }
  }

  async function handleBrandingRemove(asset: BrandingAsset) {
    setBrandingError(null);
    try {
      const status = await companyApi.removeBrandingAsset(asset);
      setBranding(status);
      setBrandingVersion((v) => v + 1);
    } catch (err) {
      setBrandingError(apiErrorMessage(err, "Nepodarilo sa odstrániť súbor"));
    }
  }

  async function handleSapiSubmit(e: FormEvent) {
    e.preventDefault();
    setSapiError(null);
    setSavingSapi(true);
    try {
      const status = await companyApi.saveSapiCredentials(clientId, clientSecret);
      setSapiStatus(status);
      setClientId("");
      setClientSecret("");
    } catch (err) {
      setSapiError(apiErrorMessage(err, "Nepodarilo sa uložiť SAPI-SK prístup"));
    } finally {
      setSavingSapi(false);
    }
  }

  async function handleToggleMode() {
    const nextMode = sapiStatus.mode === "mock" ? "live" : "mock";
    if (nextMode === "live" && !confirmLive) return;
    setSapiError(null);
    try {
      const status = await companyApi.setSapiMode(nextMode);
      setSapiStatus(status);
      setConfirmLive(false);
    } catch (err) {
      setSapiError(apiErrorMessage(err));
    }
  }

  async function handleDeleteSapi() {
    setSapiError(null);
    try {
      await companyApi.deleteSapiCredentials();
      setSapiStatus({ configured: false, mode: "mock" });
    } catch (err) {
      setSapiError(apiErrorMessage(err));
    }
  }

  if (loading) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Nastavenia</h1>
        <p className="mt-1 text-sm text-ink-500">Údaje o tvojej firme a napojenie na SAPI-SK.</p>
      </div>

      {reason === "welcome" && (
        <Alert tone="info" title="Vitaj!">
          Najprv vyplň údaje o svojej firme — použijú sa ako dodávateľ na každej vygenerovanej faktúre.
        </Alert>
      )}
      {reason === "company-profile-required" && (
        <Alert tone="warning" title="Chýbajú údaje o firme">
          Pred vytvorením faktúry musíš najprv vyplniť údaje o svojej firme nižšie.
        </Alert>
      )}

      <Card>
        <CardHeader title="Údaje o firme (dodávateľ)" description="Tieto údaje sa použijú ako dodávateľ na každej faktúre." />
        <CardBody>
          <form onSubmit={handleProfileSubmit} className="flex flex-col gap-4">
            {profileError && <Alert tone="danger">{profileError}</Alert>}
            {profileSaved && <Alert tone="success">Údaje uložené.</Alert>}
            <Input
              label="Názov firmy"
              required
              maxLength={256}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="IČO"
                required
                placeholder="12345678"
                value={profile.ico}
                onChange={(e) => setProfile({ ...profile, ico: e.target.value })}
              />
              <Input
                label="DIČ"
                required
                placeholder="1234567890"
                hint="Aj Peppol participant ID (0245)"
                value={profile.dic}
                onChange={(e) => setProfile({ ...profile, dic: e.target.value })}
              />
              <Input
                label="IČ DPH"
                placeholder="SK1234567890"
                hint="Nechaj prázdne, ak nie si platca DPH"
                value={profile.icDph ?? ""}
                onChange={(e) => setProfile({ ...profile, icDph: e.target.value || null })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Ulica a číslo"
                required
                className="sm:col-span-1"
                value={profile.street}
                onChange={(e) => setProfile({ ...profile, street: e.target.value })}
              />
              <Input
                label="Mesto"
                required
                value={profile.city}
                onChange={(e) => setProfile({ ...profile, city: e.target.value })}
              />
              <Input
                label="PSČ"
                required
                placeholder="81101"
                value={profile.postalCode}
                onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="IBAN"
                required
                placeholder="SK9711000000002612345678"
                value={profile.iban}
                onChange={(e) => setProfile({ ...profile, iban: e.target.value.toUpperCase() })}
              />
              <Input
                label="BIC/SWIFT"
                placeholder="Nepovinné"
                value={profile.bic ?? ""}
                onChange={(e) => setProfile({ ...profile, bic: e.target.value || null })}
              />
            </div>
            <Button type="submit" loading={savingProfile} className="self-start">
              Uložiť údaje o firme
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Vzhľad PDF faktúry"
          description="Voliteľné logo, pečiatka a podpis, ktoré sa vložia do generovaného PDF."
        />
        <CardBody className="flex flex-col gap-3">
          {brandingError && <Alert tone="danger">{brandingError}</Alert>}
          {!hasProfile ? (
            <Alert tone="info">Najprv ulož údaje o firme vyššie — až potom môžeš nahrať logo, pečiatku a podpis.</Alert>
          ) : (
            BRANDING_ROWS.map((row) => (
              <BrandingAssetRow
                key={row.asset}
                asset={row.asset}
                label={row.label}
                hint={row.hint}
                present={branding[row.asset]}
                version={brandingVersion}
                uploading={uploadingAsset === row.asset}
                onUpload={(file) => handleBrandingUpload(row.asset, file)}
                onRemove={() => handleBrandingRemove(row.asset)}
              />
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="SAPI-SK napojenie"
          description="Na odosielanie faktúr priamo do siete Peppol cez digitálneho poštára."
          action={<Badge tone={sapiStatus.mode === "live" ? "danger" : "neutral"}>{sapiStatus.mode === "live" ? "LIVE" : "MOCK"}</Badge>}
        />
        <CardBody className="flex flex-col gap-4">
          <Alert tone={sapiStatus.mode === "live" ? "warning" : "info"}>
            {sapiStatus.mode === "live"
              ? "Si v LIVE režime — odoslanie faktúry sa pokúsi reálne odoslať dokument cez SAPI-SK do siete Peppol."
              : "Si v MOCK režime — odoslanie faktúry len simuluje úspešnú odpoveď, nič sa reálne neposiela."}
          </Alert>
          {sapiError && <Alert tone="danger">{sapiError}</Alert>}

          {sapiStatus.configured ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-700">
                Client ID: <span className="font-mono">{sapiStatus.clientId}</span>
              </p>
              {sapiStatus.mode === "mock" && (
                <label className="flex items-start gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                    checked={confirmLive}
                    onChange={(e) => setConfirmLive(e.target.checked)}
                  />
                  Rozumiem, že v LIVE režime sa faktúry reálne odosielajú do siete Peppol.
                </label>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant={sapiStatus.mode === "mock" ? "accent" : "secondary"}
                  disabled={sapiStatus.mode === "mock" && !confirmLive}
                  onClick={handleToggleMode}
                >
                  {sapiStatus.mode === "mock" ? "Prepnúť na LIVE" : "Prepnúť späť na MOCK"}
                </Button>
                <Button type="button" variant="danger" onClick={handleDeleteSapi}>
                  Odstrániť prístup
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSapiSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Client ID" required value={clientId} onChange={(e) => setClientId(e.target.value)} />
                <Input
                  label="Client Secret"
                  type="password"
                  required
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  hint="Uloží sa zašifrovane, nikdy sa nezobrazí späť."
                />
              </div>
              <Button type="submit" loading={savingSapi} className="self-start">
                Uložiť prístupové údaje
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
