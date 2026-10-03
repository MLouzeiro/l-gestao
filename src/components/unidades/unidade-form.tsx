"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  _apagarUnidade,
  _atualizarUnidade,
  _criarUnidade,
  type UnidadeActionResult,
} from "@/actions/unidades";

type UnidadeOpcao = { id: string; code: string; name: string; type: string };
type ResponsavelOpcao = { userId: string; name: string; email: string };

export type UnidadeFormInicial = {
  unitId: string | null;
  code: string;
  name: string;
  type: "MATRIZ" | "FILIAL" | "POSTO";
  parentId: string | null;
  managerUserId: string | null;
};

export function UnidadeForm({
  unidades,
  responsaveis,
  initial,
}: {
  unidades: UnidadeOpcao[];
  responsaveis: ResponsavelOpcao[];
  initial: UnidadeFormInicial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[]>
  >({});
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      code: String(form.get("code") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      type: String(form.get("type") ?? "MATRIZ"),
      parentId: form.get("parentId") ? String(form.get("parentId")) : null,
      managerUserId: form.get("managerUserId")
        ? String(form.get("managerUserId"))
        : null,
    };
    setError(null);
    setOkMsg(null);
    setFieldErrors({});
    startTransition(async () => {
      const res: UnidadeActionResult<{ id: string }> = initial.unitId
        ? await _atualizarUnidade(initial.unitId, payload)
        : await _criarUnidade(payload);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      if (initial.unitId) {
        setOkMsg("Unidade salva.");
        router.refresh();
      } else {
        router.push(`/unidades/${res.data.id}`);
      }
    });
  }

  function onExcluir(): void {
    if (!initial.unitId) return;
    if (!window.confirm("Remover esta unidade?")) return;
    setError(null);
    startTransition(async () => {
      const res = await _apagarUnidade(initial.unitId!);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/unidades");
      router.refresh();
    });
  }

  const err = (k: string): string | undefined => fieldErrors[k]?.[0];

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Código *
          </label>
          <input
            name="code"
            defaultValue={initial.code}
            maxLength={30}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          {err("code") && (
            <p className="mt-1 text-xs text-rose-600">{err("code")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Nome *
          </label>
          <input
            name="name"
            defaultValue={initial.name}
            maxLength={120}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          {err("name") && (
            <p className="mt-1 text-xs text-rose-600">{err("name")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Tipo *
          </label>
          <select
            name="type"
            defaultValue={initial.type}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="MATRIZ">Matriz</option>
            <option value="FILIAL">Filial</option>
            <option value="POSTO">Posto</option>
          </select>
          {err("type") && (
            <p className="mt-1 text-xs text-rose-600">{err("type")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Unidade pai
          </label>
          <select
            name="parentId"
            defaultValue={initial.parentId ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— sem pai (raiz) —</option>
            {unidades
              .filter((u) => u.id !== initial.unitId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </option>
              ))}
          </select>
          {err("parentId") && (
            <p className="mt-1 text-xs text-rose-600">{err("parentId")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Responsável
          </label>
          <select
            name="managerUserId"
            defaultValue={initial.managerUserId ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— sem responsável —</option>
            {responsaveis.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name}
              </option>
            ))}
          </select>
          {err("managerUserId") && (
            <p className="mt-1 text-xs text-rose-600">
              {err("managerUserId")}
            </p>
          )}
        </div>
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

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending
            ? "Salvando..."
            : initial.unitId
              ? "Salvar alterações"
              : "Criar unidade"}
        </button>
        {initial.unitId && (
          <button
            type="button"
            onClick={onExcluir}
            disabled={pending}
            className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            Remover
          </button>
        )}
      </div>
    </form>
  );
}
