import type { ExpiryStatus } from "@/server/modules/lotes/batch-rules";

// Badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<ExpiryStatus, string> = {
  VENCIDO: "b-rose",
  CRITICO: "b-orange",
  PROXIMO: "b-amber",
  OK: "b-emerald",
  SEM_VALIDADE: "b-slate",
};

export function ValidadeBadge({
  status,
  label,
}: {
  status: ExpiryStatus;
  label: string;
}) {
  return <span className={`badge ${ESTILOS[status]}`}>{label}</span>;
}
