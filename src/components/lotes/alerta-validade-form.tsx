"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { _salvarAlertaValidade } from "@/actions/lotes";

// Janelas de alerta de validade (dias antes do vencimento) — ADMIN.
export function AlertaValidadeForm({ dias }: { dias: number[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [valor, setValor] = useState(dias.join(", "));

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const lista = valor
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    startTransition(async () => {
      const res = await _salvarAlertaValidade({ dias: lista });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOkMsg("Configuração salva.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Alertar com quantos dias antes do vencimento (separados por vírgula)
        </label>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="7, 30, 90"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {okMsg && <p className="text-xs text-emerald-600">{okMsg}</p>}
    </form>
  );
}
