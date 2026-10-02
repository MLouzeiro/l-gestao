import type { PurchaseStatus } from "@/server/modules/compras/purchase-rules";

const ESTILOS: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Em aberto", className: "bg-slate-100 text-slate-600" },
  CONFIRMED: { label: "Confirmada", className: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelada", className: "bg-rose-50 text-rose-700" },
};

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos os status" },
  { value: "OPEN", label: "Em aberto" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "CANCELLED", label: "Cancelada" },
];

export function StatusBadge({ status }: { status: PurchaseStatus | string }) {
  const s = ESTILOS[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
