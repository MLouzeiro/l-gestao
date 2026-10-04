"use client";

import type { BatchLabel } from "@/server/modules/lotes/batch-rules";

// Etiqueta de lote (impressão térmica 50×30mm) via window.print().
// O CSS (.etiqueta-impressao em globals.css) esconde a app e imprime só ela.
export function EtiquetaLote({
  label,
  empresa,
}: {
  label: BatchLabel;
  empresa: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="etiqueta-impressao">
        <div className="text-[10px] font-semibold uppercase tracking-wide">
          {empresa ?? "L Gestão"}
        </div>
        <div className="mt-1 text-[11px] font-bold leading-tight">
          {label.productName}
        </div>
        <div className="mt-1 space-y-0.5 text-[10px]">
          <div>
            <strong>Lote:</strong> {label.batchNumber}
          </div>
          <div>
            <strong>Validade:</strong> {label.expiresText}
          </div>
          <div>
            <strong>Qtd:</strong> {label.quantityText}
          </div>
          <div>
            <strong>Cód:</strong> {label.code}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Imprimir etiqueta
      </button>
    </div>
  );
}
