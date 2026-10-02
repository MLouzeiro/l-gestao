import type { StockLevel } from "@/server/modules/relatorios/report-rules";

const LEVEL_STYLES: Record<StockLevel, { label: string; className: string }> = {
  CRITICO: { label: "Crítico", className: "bg-rose-100 text-rose-700" },
  BAIXO: { label: "Baixo", className: "bg-amber-100 text-amber-700" },
  OK: { label: "Ok", className: "bg-emerald-100 text-emerald-700" },
};

export function LevelBadge({ level }: { level: StockLevel }) {
  const s = LEVEL_STYLES[level];
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
