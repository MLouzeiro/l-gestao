// Status de venda — badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<string, { label: string; badge: string }> = {
  DRAFT: { label: "Rascunho", badge: "b-slate" },
  CONFIRMED: { label: "Confirmada", badge: "b-sky" },
  BILLED: { label: "Faturada", badge: "b-emerald" },
  CANCELLED: { label: "Cancelada", badge: "b-rose" },
  RETURNED: { label: "Devolvida", badge: "b-amber" },
};

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos os status" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "BILLED", label: "Faturada" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "RETURNED", label: "Devolvida" },
];

export function StatusBadge({ status }: { status: string }) {
  const s = ESTILOS[status] ?? { label: status, badge: "b-slate" };
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}
