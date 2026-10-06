import type { TransferStatus } from "@/server/modules/transferencias/transfer-rules";

// Badge tintado do mockup (globals.css: .badge/.b-*).
const ESTILOS: Record<TransferStatus, { label: string; badge: string }> = {
  DRAFT: { label: "Rascunho", badge: "b-slate" },
  SENT: { label: "Enviada", badge: "b-sky" },
  RECEIVED: { label: "Recebida", badge: "b-emerald" },
  CANCELLED: { label: "Cancelada", badge: "b-rose" },
};

export function StatusTransferenciaBadge({
  status,
}: {
  status: TransferStatus;
}) {
  const e = ESTILOS[status];
  return <span className={`badge ${e.badge}`}>{e.label}</span>;
}
