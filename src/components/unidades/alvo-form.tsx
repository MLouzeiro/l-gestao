"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { _apagarAlvo, _salvarAlvo } from "@/actions/unidades";

type Opcao = { id: string; name: string; sku?: string };

export type AlvoView = {
  productId: string;
  sku: string;
  name: string;
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
};

function qtyText(v: number | null): string {
  return v === null ? "—" : String(v).replace(".", ",");
}

function parseQty(value: string): number | null {
  const s = value.trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Estoque-alvo por produto nesta unidade (mínimo, máximo, ponto de reposição).
export function AlvoForm({
  unitId,
  produtos,
  alvos,
}: {
  unitId: string;
  produtos: Opcao[];
  alvos: AlvoView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const productId = String(form.get("productId") ?? "");
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await _salvarAlvo({
        unitId,
        productId,
        minQty: parseQty(String(form.get("minQty") ?? "")),
        maxQty: parseQty(String(form.get("maxQty") ?? "")),
        reorderPoint: parseQty(String(form.get("reorderPoint") ?? "")),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOkMsg("Estoque-alvo salvo.");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onRemover(productId: string): void {
    setError(null);
    startTransition(async () => {
      const res = await _apagarAlvo({ unitId, productId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        className="grid items-end gap-3 sm:grid-cols-5"
      >
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Produto *
          </label>
          <select
            name="productId"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">selecione…</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku ? `${p.sku} · ` : ""}
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Mínimo
          </label>
          <input
            name="minQty"
            inputMode="decimal"
            placeholder="0"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Máximo
          </label>
          <input
            name="maxQty"
            inputMode="decimal"
            placeholder="0"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Reposição
          </label>
          <div className="flex gap-2">
            <input
              name="reorderPoint"
              inputMode="decimal"
              placeholder="0"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? "..." : "Salvar"}
            </button>
          </div>
        </div>
      </form>

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

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                Produto
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                Mínimo
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                Máximo
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                Reposição
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {alvos.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-sm text-slate-500"
                >
                  Nenhum estoque-alvo definido para esta unidade.
                </td>
              </tr>
            )}
            {alvos.map((a) => (
              <tr key={a.productId}>
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-800">{a.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{a.sku}</span>
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {qtyText(a.minQty)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {qtyText(a.maxQty)}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {qtyText(a.reorderPoint)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRemover(a.productId)}
                    disabled={pending}
                    className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                  >
                    remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
