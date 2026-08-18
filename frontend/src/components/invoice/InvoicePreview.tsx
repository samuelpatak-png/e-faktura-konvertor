import type { InvoiceSummary } from "../../lib/types";
import { formatEur } from "../../lib/format";

export function InvoicePreview({ summary }: { summary: InvoiceSummary }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink-500">Základ dane (bez DPH)</td>
            <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-900">{formatEur(summary.netAmount)}</td>
          </tr>
          {summary.taxBreakdown.map((b) => (
            <tr key={b.taxRatePercent} className="border-b border-line">
              <td className="px-4 py-2 pl-8 text-ink-500">DPH {b.taxRatePercent} % zo základu {formatEur(b.taxableAmount)}</td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-900">{formatEur(b.taxAmount)}</td>
            </tr>
          ))}
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink-500">DPH spolu</td>
            <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-900">{formatEur(summary.taxAmount)}</td>
          </tr>
          <tr className="bg-canvas">
            <td className="px-4 py-2.5 font-semibold text-ink-900">Suma na úhradu</td>
            <td className="px-4 py-2.5 text-right font-mono text-base font-semibold tabular-nums text-ink-900">
              {formatEur(summary.grossAmount)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
