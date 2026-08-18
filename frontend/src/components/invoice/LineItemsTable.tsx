import { UNIT_CODES, VAT_RATES, type InvoiceLineInput, type UnitCode, type VatRate } from "../../lib/types";
import { formatEur } from "../../lib/format";
import { Button } from "../ui/Button";

const EMPTY_LINE: InvoiceLineInput = {
  description: "",
  quantity: 1,
  unitCode: "C62",
  unitPrice: 0,
  taxRatePercent: 23,
};

interface Props {
  lines: InvoiceLineInput[];
  onChange: (lines: InvoiceLineInput[]) => void;
}

export function LineItemsTable({ lines, onChange }: Props) {
  function updateLine(index: number, patch: Partial<InvoiceLineInput>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2">Popis</th>
              <th className="w-24 px-3 py-2">Množstvo</th>
              <th className="w-24 px-3 py-2">MJ</th>
              <th className="w-32 px-3 py-2">Jedn. cena (€)</th>
              <th className="w-28 px-3 py-2">DPH</th>
              <th className="w-28 px-3 py-2 text-right">Spolu bez DPH</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <input
                    required
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    placeholder="Napr. Webdizajn"
                    className="w-full rounded-md border border-line px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    required
                    min={0.001}
                    step="any"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
                    className="w-full rounded-md border border-line px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={line.unitCode}
                    onChange={(e) => updateLine(index, { unitCode: e.target.value as UnitCode })}
                    className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {UNIT_CODES.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: Number(e.target.value) })}
                    className="w-full rounded-md border border-line px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={line.taxRatePercent}
                    onChange={(e) => updateLine(index, { taxRatePercent: Number(e.target.value) as VatRate })}
                    className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {VAT_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} %
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-700">
                  {formatEur(line.quantity * line.unitPrice)}
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length === 1}
                    aria-label="Odstrániť položku"
                    className="cursor-pointer rounded-md p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addLine} className="self-start">
        + Pridať položku
      </Button>
    </div>
  );
}

export { EMPTY_LINE };
