import { useState } from "react";

export function XmlPreview({ xml }: { xml: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(xml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    // Always-dark code viewer regardless of site theme — bg-neutral-900 (fixed), not the
    // ink-900 token (which flips to white in dark mode).
    <div className="relative overflow-hidden rounded-lg border border-line bg-neutral-900">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 cursor-pointer rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {copied ? "Skopírované!" : "Kopírovať"}
      </button>
      <pre className="max-h-96 overflow-auto p-4 text-xs leading-relaxed text-slate-100">
        <code className="font-mono">{xml}</code>
      </pre>
    </div>
  );
}
