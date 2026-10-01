"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { _abrirInventario, type InventarioFormState } from "@/actions/inventario";

function Botao({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Abrindo..." : children}
    </button>
  );
}

export function AbrirInventarioForm({
  depositos,
}: {
  depositos: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<InventarioFormState, FormData>(
    _abrirInventario,
    null,
  );

  return (
    <form
      action={formAction}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-800">Novo inventário</h2>
      {depositos.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          Nenhum depósito cadastrado.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-500">
            Depósito
            <select
              name="warehouseId"
              required
              defaultValue={depositos[0]?.id}
              className="mt-1 block w-56 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              {depositos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Observação (opcional)
            <input
              name="notes"
              maxLength={500}
              placeholder="Contagem semestral, ..."
              className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>
          <Botao>Abrir inventário</Botao>
          {state?.error && (
            <span className="text-xs font-medium text-rose-600">
              {state.error}
            </span>
          )}
          {state?.ok && (
            <span className="text-xs font-medium text-emerald-600">
              {state.message}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
