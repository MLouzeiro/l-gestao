import type { TransferStatus } from "@/server/modules/transferencias/transfer-rules";

const ESTILOS: Record<TransferStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Rascunho", cls: "bg-slate-100 text-slate-600" },
  SENT: { label: "Enviada", cls: "bg-sky-100 text-sky-700" },
  RECEIVED: { label: "Recebida", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelada", cls: "bg-rose-100 text-rose-700" },
};

export function StatusTransferenciaBadge({ status }: { status: TransferStatus }) {
  const e = ESTILOS[status];
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${e.cls}`}
    >
      {e.label}
    </span>
  );
}
