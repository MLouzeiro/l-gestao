const ESTILOS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Rascunho", className: "bg-slate-100 text-slate-600" },
  CONFIRMED: { label: "Confirmada", className: "bg-amber-50 text-amber-700" },
  BILLED: { label: "Faturada", className: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelada", className: "bg-rose-50 text-rose-700" },
  RETURNED: { label: "Devolvida", className: "bg-sky-50 text-sky-700" },
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
  const s = ESTILOS[status] ?? {
    label: status,
    className: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
