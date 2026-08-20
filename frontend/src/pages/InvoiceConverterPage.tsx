import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoiceApi, partnerApi, apiErrorMessage, apiValidationErrors } from "../lib/api";
import type { CustomerInput, ExtractedInvoiceData, GenerateResult, InvoiceInput, InvoiceLineInput, Partner, ValidationResult } from "../lib/types";
import { useAuth } from "../lib/auth";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { PdfUpload } from "../components/invoice/PdfUpload";
import { LineItemsTable } from "../components/invoice/LineItemsTable";
import { InvoicePreview } from "../components/invoice/InvoicePreview";
import { XmlPreview } from "../components/invoice/XmlPreview";
import { PartnerAutocomplete } from "../components/invoice/PartnerAutocomplete";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const EMPTY_CUSTOMER: CustomerInput = { name: "", ico: "", dic: "", icDph: "", street: "", city: "", postalCode: "", country: "SK", email: "" };

function emptyLines(): InvoiceLineInput[] {
  return [{ description: "", quantity: 1, unitCode: "C62", unitPrice: 0, taxRatePercent: 23 }];
}

export function InvoiceConverterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isVatPayer = Boolean(user?.companyProfile?.icDph);

  const [customer, setCustomer] = useState<CustomerInput>(EMPTY_CUSTOMER);
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(plusDays(today(), 14));
  const [buyerReference, setBuyerReference] = useState("");
  const [lines, setLines] = useState<InvoiceLineInput[]>(emptyLines());

  const [isAdvanceTaxDocument, setIsAdvanceTaxDocument] = useState(false);
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [prepaidReference, setPrepaidReference] = useState("");

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);

  const [confirmCorrect, setConfirmCorrect] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [generating, setGenerating] = useState(false);

  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const [partnerSaveState, setPartnerSaveState] = useState<"checking" | "offer" | "exists" | "saving" | "saved" | "error">("checking");

  // Offer "save to registry" only once, right after a successful generation, and only if no
  // partner with this exact DIČ already exists — never re-check on every render.
  useEffect(() => {
    if (!generateResult?.success) return;
    let cancelled = false;
    partnerApi
      .list({ dic: customer.dic, includeInactive: true, pageSize: 1 })
      .then((res) => {
        if (!cancelled) setPartnerSaveState(res.total > 0 ? "exists" : "offer");
      })
      .catch(() => {
        if (!cancelled) setPartnerSaveState("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateResult?.success]);

  async function handleSaveCustomerAsPartner() {
    setPartnerSaveState("saving");
    try {
      await partnerApi.create({
        name: customer.name,
        ico: customer.ico || null,
        dic: customer.dic,
        icDph: customer.icDph || null,
        street: customer.street,
        city: customer.city,
        postalCode: customer.postalCode,
        countryCode: customer.country,
        peppolScheme: null,
        peppolId: null,
        email: customer.email || null,
        note: null,
        category: null,
      });
      setPartnerSaveState("saved");
    } catch {
      setPartnerSaveState("error");
    }
  }

  function handleSelectPartner(partner: Partner) {
    setCustomer({
      name: partner.name,
      ico: partner.ico ?? "",
      dic: partner.dic,
      icDph: partner.icDph ?? "",
      street: partner.street,
      city: partner.city,
      postalCode: partner.postalCode,
      country: partner.countryCode,
      email: partner.email ?? "",
    });
    invalidateValidation();
  }

  function invalidateValidation() {
    setValidation(null);
    setConfirmCorrect(false);
    setConfirmSend(false);
  }

  // Only prefill fields that unambiguously belong to "this invoice" (number/dates) — never the
  // supplier (always the account's own Company Profile) or customer identity from a parsed PDF,
  // since we can't tell whose invoice was uploaded and a wrong auto-fill there is easy to miss.
  function handleExtracted(data: ExtractedInvoiceData) {
    if (data.invoiceNumber.value) setNumber(data.invoiceNumber.value);
    if (data.issueDate.value) setIssueDate(data.issueDate.value);
    if (data.dueDate.value) setDueDate(data.dueDate.value);
    invalidateValidation();
  }

  function buildInput(): InvoiceInput {
    return {
      customer: { ...customer, icDph: customer.icDph || undefined, ico: customer.ico || undefined, email: customer.email || undefined },
      number,
      issueDate,
      dueDate,
      buyerReference,
      lines,
      isAdvanceTaxDocument: isVatPayer && isAdvanceTaxDocument ? true : undefined,
      prepaidAmountCents: prepaidAmount ? Math.round(Number(prepaidAmount) * 100) : undefined,
      prepaidReference: prepaidReference.trim() || undefined,
    };
  }

  async function handleValidate() {
    setValidateError(null);
    setValidating(true);
    setGenerateResult(null);
    try {
      const result = await invoiceApi.validate(buildInput());
      setValidation(result);
      setConfirmCorrect(false);
      setConfirmSend(false);
    } catch (err) {
      setValidateError(apiErrorMessage(err, "Kontrolu sa nepodarilo vykonať"));
    } finally {
      setValidating(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await invoiceApi.generate(buildInput());
      setGenerateResult(result);
    } catch (err) {
      // A 422 ("faktúra už nie je platná") rejects the promise rather than resolving it —
      // surface the server's specific reasons via the same validation-errors panel used
      // after "Skontrolovať faktúru", instead of a generic failure message.
      const backendValidation = apiValidationErrors(err);
      if (backendValidation) {
        setValidation(backendValidation);
        setConfirmCorrect(false);
        setConfirmSend(false);
      } else {
        setGenerateResult({ success: false, errors: [apiErrorMessage(err, "Generovanie zlyhalo")] });
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!generateResult?.invoiceId) return;
    setSendState("sending");
    setSendMessage(null);
    try {
      const result = await invoiceApi.sendSapi(generateResult.invoiceId);
      if (result.success) {
        setSendState("sent");
        setSendMessage(result.mock ? "Simulované odoslanie prebehlo úspešne (MOCK režim)." : `Faktúra bola odoslaná. ID: ${result.providerDocumentId}`);
      } else {
        setSendState("failed");
        setSendMessage(result.error ?? "Odoslanie zlyhalo");
      }
    } catch (err) {
      setSendState("failed");
      setSendMessage(apiErrorMessage(err));
    }
  }

  function resetForm() {
    setCustomer(EMPTY_CUSTOMER);
    setNumber("");
    setIssueDate(today());
    setDueDate(plusDays(today(), 14));
    setBuyerReference("");
    setLines(emptyLines());
    setValidation(null);
    setConfirmCorrect(false);
    setConfirmSend(false);
    setGenerateResult(null);
    setSendState("idle");
    setSendMessage(null);
    setPartnerSaveState("checking");
  }

  if (generateResult?.success) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Alert tone="success" title="Faktúra bola vygenerovaná">
          Faktúra {number} bola úspešne vygenerovaná a uložená do histórie.
        </Alert>
        {generateResult.summary && <InvoicePreview summary={generateResult.summary} />}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => window.open(invoiceApi.downloadUrl(generateResult.invoiceId!), "_blank")}>
            Stiahnuť XML
          </Button>
          <Button variant="accent" loading={sendState === "sending"} disabled={sendState === "sent"} onClick={handleSend}>
            {sendState === "sent" ? "Odoslané" : "Odoslať cez SAPI-SK"}
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/app/invoices/${generateResult.invoiceId}`)}>
            Zobraziť detail
          </Button>
        </div>
        {sendMessage && <Alert tone={sendState === "sent" ? "success" : "danger"}>{sendMessage}</Alert>}

        {partnerSaveState === "offer" && (
          <Alert tone="info" title="Uložiť odberateľa do číselníka?">
            <div className="flex items-center justify-between gap-3">
              <span>Tento odberateľ ešte nie je v číselníku — nabudúce sa dá vybrať autocompletom.</span>
              <Button size="sm" variant="secondary" onClick={handleSaveCustomerAsPartner}>
                Uložiť
              </Button>
            </div>
          </Alert>
        )}
        {partnerSaveState === "saved" && <Alert tone="success">Odberateľ bol uložený do číselníka.</Alert>}

        {generateResult.xml && <XmlPreview xml={generateResult.xml} />}
        <Button variant="ghost" onClick={resetForm} className="self-start">
          + Vytvoriť ďalšiu faktúru
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Nová faktúra</h1>
        <p className="mt-1 text-sm text-ink-500">Nahraj PDF faktúru na predvyplnenie, alebo vyplň údaje ručne.</p>
      </div>

      <Card>
        <CardHeader title="1. PDF faktúra (voliteľné)" description="Extrakcia je len odhad z regexov — vždy skontroluj vyplnené polia." />
        <CardBody>
          <PdfUpload onExtracted={handleExtracted} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Odberateľ" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PartnerAutocomplete
            className="sm:col-span-2"
            value={customer.name}
            onChange={(name) => {
              setCustomer({ ...customer, name });
              invalidateValidation();
            }}
            onSelect={handleSelectPartner}
          />
          <Input
            label="IČO"
            value={customer.ico ?? ""}
            onChange={(e) => {
              setCustomer({ ...customer, ico: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="DIČ"
            required
            hint="Peppol participant ID (0245)"
            value={customer.dic}
            onChange={(e) => {
              setCustomer({ ...customer, dic: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="IČ DPH"
            value={customer.icDph ?? ""}
            onChange={(e) => {
              setCustomer({ ...customer, icDph: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="Email"
            type="email"
            hint="Na tento email pôjde faktúra a prípadné upomienky"
            value={customer.email ?? ""}
            onChange={(e) => {
              setCustomer({ ...customer, email: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="Ulica a číslo"
            required
            value={customer.street}
            onChange={(e) => {
              setCustomer({ ...customer, street: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="Mesto"
            required
            value={customer.city}
            onChange={(e) => {
              setCustomer({ ...customer, city: e.target.value });
              invalidateValidation();
            }}
          />
          <Input
            label="PSČ"
            required
            value={customer.postalCode}
            onChange={(e) => {
              setCustomer({ ...customer, postalCode: e.target.value });
              invalidateValidation();
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3. Faktúra" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Číslo faktúry"
            required
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              invalidateValidation();
            }}
          />
          <Input
            label="Referencia objednávateľa"
            required
            hint="Napr. číslo objednávky; povinné pre Peppol (BuyerReference)"
            value={buyerReference}
            onChange={(e) => {
              setBuyerReference(e.target.value);
              invalidateValidation();
            }}
          />
          <Input
            label="Dátum vystavenia"
            type="date"
            required
            value={issueDate}
            onChange={(e) => {
              setIssueDate(e.target.value);
              invalidateValidation();
            }}
          />
          <Input
            label="Dátum splatnosti"
            type="date"
            required
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              invalidateValidation();
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Preddavok (voliteľné)"
          description="Vyplň, ak odberateľ už časť sumy zaplatil vopred — odpočíta sa zo sumy na úhradu."
        />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Už uhradený preddavok (€)"
            type="number"
            min={0}
            step="0.01"
            value={prepaidAmount}
            onChange={(e) => {
              setPrepaidAmount(e.target.value);
              invalidateValidation();
            }}
          />
          <Input
            label="Referencia na preddavkový doklad"
            hint="Napr. číslo daňového dokladu k prijatej platbe — EN16931 nemá na toto štruktúrované pole, ide ako poznámka"
            value={prepaidReference}
            onChange={(e) => {
              setPrepaidReference(e.target.value);
              invalidateValidation();
            }}
          />
          {isVatPayer && (
            <label className="flex items-start gap-2 text-sm text-ink-700 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                checked={isAdvanceTaxDocument}
                onChange={(e) => {
                  setIsAdvanceTaxDocument(e.target.checked);
                  invalidateValidation();
                }}
              />
              Toto je daňový doklad k prijatej platbe (preddavku), nie bežná faktúra — InvoiceTypeCode 386
            </label>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4. Položky" />
        <CardBody>
          <LineItemsTable
            lines={lines}
            onChange={(next) => {
              setLines(next);
              invalidateValidation();
            }}
          />
        </CardBody>
      </Card>

      {validateError && <Alert tone="danger">{validateError}</Alert>}

      {!validation && (
        <Button size="lg" loading={validating} onClick={handleValidate} className="self-start">
          Skontrolovať faktúru
        </Button>
      )}

      {validation && !validation.valid && (
        <Alert tone="danger" title="Faktúru treba opraviť">
          <ul className="list-disc pl-4">
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {validation?.valid && validation.summary && (
        <Card>
          <CardHeader title="5. Kontrola a potvrdenie" description="Skontroluj súhrn a XML pred vygenerovaním." />
          <CardBody className="flex flex-col gap-4">
            {validation.warnings.length > 0 && (
              <Alert tone="warning">
                <ul className="list-disc pl-4">
                  {validation.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <InvoicePreview summary={validation.summary} />
            {validation.xml && <XmlPreview xml={validation.xml} />}

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                  checked={confirmCorrect}
                  onChange={(e) => setConfirmCorrect(e.target.checked)}
                />
                Faktúra je správna
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                  checked={confirmSend}
                  onChange={(e) => setConfirmSend(e.target.checked)}
                />
                Potvrdzujem vygenerovanie a uloženie tejto faktúry
              </label>
            </div>

            {generateResult && !generateResult.success && (
              <Alert tone="danger">{generateResult.errors?.join(" ") ?? "Generovanie zlyhalo"}</Alert>
            )}

            <Button
              size="lg"
              variant="accent"
              disabled={!confirmCorrect || !confirmSend}
              loading={generating}
              onClick={handleGenerate}
              className="self-start"
            >
              Generovať faktúru
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
