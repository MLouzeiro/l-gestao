import type { UnitType } from "@/server/modules/unidades/warehouse-rules";

const ESTILOS: Record<UnitType, string> = {
  MATRIZ: "bg-indigo-100 text-indigo-700",
  FILIAL: "bg-sky-100 text-sky-700",
  POSTO: "bg-amber-100 text-amber-700",
};

export function TipoBadge({ type }: { type: UnitType }) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${ESTILOS[type]}`}
    >
      {type}
    </span>
  );
}
