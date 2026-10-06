import type { FinancialStatus } from "@/server/modules/financeiro/financial-rules";

// Badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<string, { label: string; badge: string }> = {
  OPEN: { label: "Em aberto", badge: "b-slate" },
  PARTIAL: { label: "Parcial", badge: "b-amber" },
  OVERDUE: { label: "Vencida", badge: "b-rose" },
  PAID: { label: "Quitada", badge: "b-emerald" },
  CANCELLED: { label: "Cancelada", badge: "b-slate" },
};

export const DIRECTION_LABELS: Record<"RECEIVABLE" | "PAYABLE", string> = {
  RECEIVABLE: "A receber",
  PAYABLE: "A pagar",
};

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos os status" },
  { value: "OPEN", label: "Em aberto" },
  { value: "PARTIAL", label: "Parcial" },
  { value: "OVERDUE", label: "Vencida" },
  { value: "PAID", label: "Quitada" },
  { value: "CANCELLED", label: "Cancelada" },
];

export function StatusBadge({ status }: { status: FinancialStatus | string }) {
  const s = ESTILOS[status] ?? { label: status, badge: "b-slate" };
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}
