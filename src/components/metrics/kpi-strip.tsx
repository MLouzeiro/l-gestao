// Tira de indicadores (KPIs) reutilizável — Server Component puro, sem estado.
// Visual do mockup: rótulo em caixa alta, valor grande (Sora) e hint colorido.
export type KpiItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
};

const TONE_CLASS: Record<NonNullable<KpiItem["tone"]>, string> = {
  default: "text-slate-400",
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
          className="kpi glow-card rounded-xl border border-slate-200 bg-white p-4"
        >
          <h3 className="text-[11px] font-bold uppercase tracking-[0.11em] text-slate-500">
            {k.label}
          </h3>
          <p className="v mt-1 text-slate-800">{k.value}</p>
          {k.hint && (
            <p className={`d ${TONE_CLASS[k.tone ?? "default"]}`}>{k.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}
