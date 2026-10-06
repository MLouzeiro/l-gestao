import type { PurchaseStatus } from "@/server/modules/compras/purchase-rules";

// Badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<string, { label: string; badge: string }> = {
  OPEN: { label: "Em aberto", badge: "b-slate" },
  CONFIRMED: { label: "Confirmada", badge: "b-emerald" },
  CANCELLED: { label: "Cancelada", badge: "b-rose" },
};

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos os status" },
  { value: "OPEN", label: "Em aberto" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "CANCELLED", label: "Cancelada" },
];

export function StatusBadge({ status }: { status: PurchaseStatus | string }) {
  const s = ESTILOS[status] ?? { label: status, badge: "b-slate" };
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}
