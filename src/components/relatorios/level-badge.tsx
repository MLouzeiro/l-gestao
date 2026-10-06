import type { StockLevel } from "@/server/modules/relatorios/report-rules";

// Nível de estoque — badge tintado do mockup (globals.css: .badge/.b-*).
const LEVEL_STYLES: Record<StockLevel, { label: string; badge: string }> = {
  CRITICO: { label: "Crítico", badge: "b-rose" },
  BAIXO: { label: "Baixo", badge: "b-amber" },
  OK: { label: "Ok", badge: "b-emerald" },
};

export function LevelBadge({ level }: { level: StockLevel }) {
  const s = LEVEL_STYLES[level];
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}
