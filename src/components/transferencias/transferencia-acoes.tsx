"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  _cancelarTransferencia,
  _enviarTransferencia,
  _receberTransferencia,
} from "@/actions/transferencias";
import type { TransferStatus } from "@/server/modules/transferencias/transfer-rules";

// Ações do workflow: enviar (DRAFT), receber (SENT), cancelar (DRAFT/SENT).
export function TransferenciaAcoes({
  transferId,
  status,
}: {
  transferId: string;
  status: TransferStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(
    action: (id: string) => Promise<{ ok: boolean; error?: string }>,
    confirmMsg?: string,
  ): void {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await action(transferId);
      if (!res.ok) {
        setError(res.error ?? "Falha na operação.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(_enviarTransferencia)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? "Processando..." : "Enviar"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(_cancelarTransferencia, "Cancelar esta transferência?")
              }
              className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              Cancelar
            </button>
          </>
        )}
        {status === "SENT" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(_receberTransferencia)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {pending ? "Processando..." : "Confirmar recebimento"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  _cancelarTransferencia,
                  "Cancelar a transferência enviada? O material retorna à origem.",
                )
              }
              className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              Cancelar
            </button>
          </>
        )}
        {(status === "RECEIVED" || status === "CANCELLED") && (
          <span className="text-sm text-slate-500">
            Transferência encerrada — nenhuma ação disponível.
          </span>
        )}
      </div>
      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
