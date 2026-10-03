"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { _alternarModulo } from "@/actions/modulos";

// Botão ativar/desativar módulo contratado (Administração → Módulos).

export function ModuloToggle({
  moduleKey,
  active,
}: {
  moduleKey: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await _alternarModulo({ key: moduleKey, active: !active });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
          active
            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
        } disabled:opacity-60`}
      >
        {busy ? "Salvando..." : active ? "Ativo — desativar" : "Inativo — ativar"}
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}
