import { useRef, useState } from "react";
import { pdfApi, apiErrorMessage } from "../../lib/api";
import type { ExtractedInvoiceData } from "../../lib/types";
import { Button } from "../ui/Button";
import { Alert } from "../ui/Alert";
import { Spinner } from "../ui/Spinner";

function confidenceTone(confidence: number): string {
  if (confidence >= 0.75) return "text-success-600";
  if (confidence >= 0.4) return "text-amber-600";
  return "text-ink-500";
}

const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: "Číslo faktúry",
  supplierDic: "DIČ dodávateľa",
  supplierIco: "IČO dodávateľa",
  supplierIcDph: "IČ DPH dodávateľa",
  iban: "IBAN",
  totalAmount: "Celková suma",
  taxRatePercent: "Sadzba DPH",
  issueDate: "Dátum vystavenia",
  dueDate: "Dátum splatnosti",
};

interface Props {
  onExtracted: (data: ExtractedInvoiceData) => void;
}

export function PdfUpload({ onExtracted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    setFileName(file.name);
    try {
      const { extracted } = await pdfApi.parse(file);
      setExtracted(extracted);
    } catch (err) {
      setError(apiErrorMessage(err, "Nepodarilo sa spracovať PDF"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
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
          <span className="font-medium text-brand-600">Klikni pre výber</span> alebo presuň PDF faktúru sem
        </p>
        {fileName && <p className="text-xs text-ink-500">{fileName}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Spinner className="h-4 w-4 text-brand-600" /> Spracúvam PDF…
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {extracted && !loading && (
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm font-medium text-ink-900">
            Nájdené údaje (celková istota {Math.round(extracted.overallConfidence * 100)} %)
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {Object.entries(extracted)
              .filter(([key]) => key !== "overallConfidence")
              .map(([key, field]) => {
                const f = field as { value: unknown; confidence: number };
                return (
                  <li key={key} className="flex items-center justify-between gap-2 border-b border-line/60 py-1">
                    <span className="text-ink-500">{FIELD_LABELS[key] ?? key}</span>
                    <span className={`font-mono ${f.value ? confidenceTone(f.confidence) : "text-ink-500/50"}`}>
                      {f.value !== null && f.value !== undefined ? String(f.value) : "—"}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            Toto je len odhad z regexov, nie AI — pred generovaním si polia nižšie prosím skontroluj.
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={() => onExtracted(extracted)}>
            Použiť tieto údaje vo formulári
          </Button>
        </div>
      )}
    </div>
  );
}
