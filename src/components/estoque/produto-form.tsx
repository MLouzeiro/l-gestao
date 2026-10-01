"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { _criarProduto, type EstoqueFormState } from "@/actions/estoque";

type Unidade = { key: string; name: string; decimals: number };

function Botao({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Salvando..." : children}
    </button>
  );
}

export function ProdutoForm({ unidades }: { unidades: Unidade[] }) {
  const [state, formAction] = useActionState<EstoqueFormState, FormData>(
    _criarProduto,
    null,
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Cadastro rápido de produto
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Cadastro completo (categorias, marcas, kits) chega na Fase 7.
      </p>
      <form action={formAction} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        <label className="text-xs font-medium text-slate-500">
          SKU *
          <input
            name="sku"
            required
            maxLength={64}
            placeholder="SKU-001"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm uppercase text-slate-800"
          />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-500">
          Nome *
          <input
            name="name"
            required
            maxLength={200}
            placeholder="Nome do produto"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Preço venda (R$) *
          <input
            name="salePrice"
            required
            inputMode="decimal"
            placeholder="19,90"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Custo inicial (R$)
          <input
            name="costPrice"
            inputMode="decimal"
            placeholder="10,00"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Unidade
          <select
            name="unitKey"
            defaultValue="UN"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            <option value="">—</option>
            {unidades.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 text-xs font-medium text-slate-600 md:col-span-4">
          <input name="trackBatch" type="checkbox" className="h-4 w-4" />
          Controla lote/validade (farmácia, laboratório, saúde)
        </label>
        <div className="col-span-2 flex items-end gap-3 md:col-span-6">
          <Botao>Cadastrar produto</Botao>
          {state?.error && (
            <span className="text-xs font-medium text-red-600">
              {state.error}
            </span>
          )}
          {state?.ok && (
            <span className="text-xs font-medium text-emerald-600">
              {state.message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
