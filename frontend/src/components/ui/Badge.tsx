type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-ink-700",
  success: "bg-green-50 text-success-600",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-danger-50 text-danger-600",
  brand: "bg-brand-50 text-brand-700",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
