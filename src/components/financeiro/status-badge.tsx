import type { FinancialStatus } from "@/server/modules/financeiro/financial-rules";

const ESTILOS: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Em aberto", className: "bg-slate-100 text-slate-600" },
  PARTIAL: { label: "Parcial", className: "bg-amber-50 text-amber-700" },
  OVERDUE: { label: "Vencida", className: "bg-rose-50 text-rose-700" },
  PAID: { label: "Quitada", className: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelada", className: "bg-slate-100 text-slate-500" },
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
  const s = ESTILOS[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
