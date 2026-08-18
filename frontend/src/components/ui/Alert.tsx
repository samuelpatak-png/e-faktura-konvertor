type Tone = "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-brand-50 border-brand-100 text-brand-900",
  success: "bg-success-600/10 border-success-600/20 text-success-600",
  warning: "bg-warning-50 border-warning-500/20 text-warning-500",
  danger: "bg-danger-50 border-danger-600/20 text-danger-600",
};

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}
