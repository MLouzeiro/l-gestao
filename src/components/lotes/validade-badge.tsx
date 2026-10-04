import type { ExpiryStatus } from "@/server/modules/lotes/batch-rules";

const ESTILOS: Record<ExpiryStatus, string> = {
  VENCIDO: "bg-rose-100 text-rose-700",
  CRITICO: "bg-orange-100 text-orange-700",
  PROXIMO: "bg-amber-100 text-amber-700",
  OK: "bg-emerald-100 text-emerald-700",
  SEM_VALIDADE: "bg-slate-100 text-slate-500",
};

export function ValidadeBadge({
  status,
  label,
}: {
  status: ExpiryStatus;
  label: string;
}) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${ESTILOS[status]}`}
    >
      {label}
    </span>
  );
}
