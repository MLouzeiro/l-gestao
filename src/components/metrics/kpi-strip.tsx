// Tira de indicadores (KPIs) reutilizável — Server Component puro, sem estado.
// Padrão visual: mesmas classes das demais telas (remap dark do globals.css).
export type KpiItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
};

const TONE_CLASS: Record<NonNullable<KpiItem["tone"]>, string> = {
  default: "text-slate-800",
  danger: "text-rose-600",
  warning: "text-amber-600",
  success: "text-emerald-600",
};

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {k.label}
          </p>
          <p
            className={`mt-1 text-lg font-semibold ${
              TONE_CLASS[k.tone ?? "default"]
            }`}
          >
            {k.value}
          </p>
          {k.hint && <p className="mt-0.5 text-xs text-slate-400">{k.hint}</p>}
        </div>
      ))}
    </div>
  );
}
