"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { _salvarMembros } from "@/actions/unidades";

export type MembroView = {
  userId: string;
  name: string;
  email: string;
  role: string;
  linked: boolean;
};

// Acesso por unidade: quem aparece marcado vê esta unidade (e as filhas).
export function MembrosForm({
  unitId,
  membros,
}: {
  unitId: string;
  membros: MembroView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(membros.filter((m) => m.linked).map((m) => m.userId)),
  );

  function toggle(id: string): void {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await _salvarMembros({
        unitId,
        userIds: [...marcados],
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOkMsg("Acesso salvo.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-slate-500">
        Usuários marcados enxergam esta unidade e as unidades filhas. Sem
        marcações, todos os usuários da empresa enxergam tudo.
      </p>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {membros.length === 0 && (
          <p className="px-2 py-3 text-sm text-slate-500">
            Nenhum usuário nesta empresa.
          </p>
        )}
        {membros.map((m) => (
          <label
            key={m.userId}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={marcados.has(m.userId)}
              onChange={() => toggle(m.userId)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="flex-1">
              <span className="font-medium text-slate-800">{m.name}</span>
              <span className="ml-2 text-xs text-slate-500">{m.email}</span>
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {m.role}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {okMsg}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar acesso"}
      </button>
    </form>
  );
}
