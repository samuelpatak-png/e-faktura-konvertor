type Tone = "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-brand-50 border-brand-100 text-brand-900",
  success: "bg-green-50 border-green-100 text-green-900",
  warning: "bg-amber-50 border-amber-100 text-amber-900",
  danger: "bg-danger-50 border-red-100 text-red-900",
};

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}
