import type { UnitType } from "@/server/modules/unidades/warehouse-rules";

// Badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<UnitType, string> = {
  MATRIZ: "b-indigo",
  FILIAL: "b-sky",
  POSTO: "b-amber",
};

export function TipoBadge({ type }: { type: UnitType }) {
  return <span className={`badge ${ESTILOS[type]}`}>{type}</span>;
}
