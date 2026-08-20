import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { companyApi, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BrandingAsset, CompanyBrandingStatus, CompanyProfileInput, EmailSettingsInput, ReminderSettings, SapiSkStatus } from "../lib/types";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { FullPageSpinner } from "../components/ui/Spinner";

const EMPTY_EMAIL_SETTINGS: EmailSettingsInput = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  fromEmail: "",
  fromName: "",
  subjectTemplate: "Faktúra {{invoiceNumber}}",
  bodyTemplate:
    "Dobrý deň,\n\nv prílohe posielame faktúru č. {{invoiceNumber}} na sumu {{amount}} so splatnosťou {{dueDate}}.\n\nS pozdravom",
};

const EMPTY_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  firstReminderDays: 7,
  reminderCount: 3,
  intervalDays: 7,
  subjectTemplate: "Upomienka: Faktúra {{invoiceNumber}} po splatnosti",
  bodyTemplate:
    "Dobrý deň,\n\npripomíname, že faktúra č. {{invoiceNumber}} na sumu {{amount}} so splatnosťou {{dueDate}} nebola doteraz uhradená. Prosíme o úhradu v čo najkratšom čase.\n\nS pozdravom",
};

const TEMPLATE_VARS_HINT = "Dostupné premenné: {{invoiceNumber}}, {{amount}}, {{dueDate}}, {{customerName}}";

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

  const [emailSettings, setEmailSettings] = useState<EmailSettingsInput>(EMPTY_EMAIL_SETTINGS);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);

  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(EMPTY_REMINDER_SETTINGS);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);

  useEffect(() => {
    Promise.all([companyApi.getProfile(), companyApi.getSapiStatus(), companyApi.getEmailSettings(), companyApi.getReminderSettings()])
      .then(([p, s, e, r]) => {
        if (p) {
          setProfile(p);
          setHasProfile(true);
          setBranding({ logo: p.logo, stamp: p.stamp, signature: p.signature });
        }
        setSapiStatus(s);
        if (e.configured) {
          setEmailConfigured(true);
          setEmailSettings({
            smtpHost: e.smtpHost ?? "",
            smtpPort: e.smtpPort ?? 587,
            smtpSecure: e.smtpSecure ?? false,
            smtpUser: e.smtpUser ?? "",
            smtpPassword: "",
            fromEmail: e.fromEmail ?? "",
            fromName: e.fromName ?? "",
            subjectTemplate: e.subjectTemplate ?? EMPTY_EMAIL_SETTINGS.subjectTemplate,
            bodyTemplate: e.bodyTemplate ?? EMPTY_EMAIL_SETTINGS.bodyTemplate,
          });
        }
        if (r) setReminderSettings(r);
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

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailSaved(false);
    setSavingEmail(true);
    try {
      await companyApi.saveEmailSettings(emailSettings);
      setEmailConfigured(true);
      setEmailSaved(true);
      setEmailSettings((prev) => ({ ...prev, smtpPassword: "" }));
    } catch (err) {
      setEmailError(apiErrorMessage(err, "Nepodarilo sa uložiť SMTP nastavenia"));
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleDeleteEmail() {
    setEmailError(null);
    try {
      await companyApi.deleteEmailSettings();
      setEmailConfigured(false);
      setEmailSettings(EMPTY_EMAIL_SETTINGS);
    } catch (err) {
      setEmailError(apiErrorMessage(err));
    }
  }

  async function handleReminderSubmit(e: FormEvent) {
    e.preventDefault();
    setReminderError(null);
    setReminderSaved(false);
    setSavingReminder(true);
    try {
      const saved = await companyApi.saveReminderSettings(reminderSettings);
      setReminderSettings(saved);
      setReminderSaved(true);
    } catch (err) {
      setReminderError(apiErrorMessage(err, "Nepodarilo sa uložiť nastavenia upomienok"));
    } finally {
      setSavingReminder(false);
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

      <Card>
        <CardHeader
          title="Odosielanie emailom"
          description="SMTP nastavenia pre odosielanie faktúr a upomienok. Väčšina firemných emailových schránok SMTP podporuje."
          action={emailConfigured ? <Badge tone="success">Nastavené</Badge> : undefined}
        />
        <CardBody>
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
            {emailError && <Alert tone="danger">{emailError}</Alert>}
            {emailSaved && <Alert tone="success">SMTP nastavenia uložené.</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="SMTP server"
                required
                className="sm:col-span-2"
                placeholder="smtp.gmail.com"
                value={emailSettings.smtpHost}
                onChange={(e) => setEmailSettings({ ...emailSettings, smtpHost: e.target.value })}
              />
              <Input
                label="Port"
                type="number"
                required
                value={emailSettings.smtpPort}
                onChange={(e) => setEmailSettings({ ...emailSettings, smtpPort: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={emailSettings.smtpSecure}
                onChange={(e) => setEmailSettings({ ...emailSettings, smtpSecure: e.target.checked })}
              />
              Použiť šifrované pripojenie (TLS) — zvyčajne pre port 465
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="SMTP používateľ"
                required
                value={emailSettings.smtpUser}
                onChange={(e) => setEmailSettings({ ...emailSettings, smtpUser: e.target.value })}
              />
              <Input
                label="SMTP heslo"
                type="password"
                required
                placeholder={emailConfigured ? "Nastavené — zadaj znova pri zmene" : undefined}
                value={emailSettings.smtpPassword}
                onChange={(e) => setEmailSettings({ ...emailSettings, smtpPassword: e.target.value })}
                hint="Uloží sa zašifrovane, nikdy sa nezobrazí späť."
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Odosielateľ (email)"
                required
                placeholder="faktury@mojafirma.sk"
                value={emailSettings.fromEmail}
                onChange={(e) => setEmailSettings({ ...emailSettings, fromEmail: e.target.value })}
              />
              <Input
                label="Odosielateľ (názov)"
                required
                placeholder="Moja Firma s.r.o."
                value={emailSettings.fromName}
                onChange={(e) => setEmailSettings({ ...emailSettings, fromName: e.target.value })}
              />
            </div>
            <Input
              label="Predmet emailu s faktúrou"
              required
              value={emailSettings.subjectTemplate}
              onChange={(e) => setEmailSettings({ ...emailSettings, subjectTemplate: e.target.value })}
            />
            <Textarea
              label="Text emailu s faktúrou"
              required
              rows={5}
              hint={TEMPLATE_VARS_HINT}
              value={emailSettings.bodyTemplate}
              onChange={(e) => setEmailSettings({ ...emailSettings, bodyTemplate: e.target.value })}
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={savingEmail}>
                Uložiť SMTP nastavenia
              </Button>
              {emailConfigured && (
                <Button type="button" variant="danger" onClick={handleDeleteEmail}>
                  Odstrániť SMTP nastavenia
                </Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Automatické upomienky" description="Pripomienky odberateľom pri faktúrach po splatnosti." />
        <CardBody>
          <form onSubmit={handleReminderSubmit} className="flex flex-col gap-4">
            {reminderError && <Alert tone="danger">{reminderError}</Alert>}
            {reminderSaved && <Alert tone="success">Nastavenia upomienok uložené.</Alert>}
            {!emailConfigured && <Alert tone="info">Najprv nastav SMTP vyššie — bez neho sa upomienky nemajú ako odoslať.</Alert>}
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={reminderSettings.enabled}
                onChange={(e) => setReminderSettings({ ...reminderSettings, enabled: e.target.checked })}
              />
              Automaticky posielať upomienky na neuhradené faktúry po splatnosti
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Prvá upomienka (dní po splatnosti)"
                type="number"
                min={1}
                required
                value={reminderSettings.firstReminderDays}
                onChange={(e) => setReminderSettings({ ...reminderSettings, firstReminderDays: Number(e.target.value) })}
              />
              <Input
                label="Počet upomienok"
                type="number"
                min={1}
                required
                value={reminderSettings.reminderCount}
                onChange={(e) => setReminderSettings({ ...reminderSettings, reminderCount: Number(e.target.value) })}
              />
              <Input
                label="Odstup medzi upomienkami (dní)"
                type="number"
                min={1}
                required
                value={reminderSettings.intervalDays}
                onChange={(e) => setReminderSettings({ ...reminderSettings, intervalDays: Number(e.target.value) })}
              />
            </div>
            <Input
              label="Predmet upomienky"
              required
              value={reminderSettings.subjectTemplate}
              onChange={(e) => setReminderSettings({ ...reminderSettings, subjectTemplate: e.target.value })}
            />
            <Textarea
              label="Text upomienky"
              required
              rows={5}
              hint={TEMPLATE_VARS_HINT}
              value={reminderSettings.bodyTemplate}
              onChange={(e) => setReminderSettings({ ...reminderSettings, bodyTemplate: e.target.value })}
            />
            <Button type="submit" loading={savingReminder} className="self-start">
              Uložiť nastavenia upomienok
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
