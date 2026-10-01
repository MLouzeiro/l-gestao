"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  _aplicarContagem,
  _descartarInventario,
  _salvarContagem,
  type InventarioFormState,
} from "@/actions/inventario";

export type InventarioItem = {
  itemId: string;
  sku: string;
  name: string;
  batchNumber: string | null;
  /** "YYYY-MM-DD" ou null */
  expiresAt: string | null;
  systemQty: number;
  countedQty: number | null;
  unitKey: string | null;
};

function fmt(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function Botao({
  children,
  variante = "primario",
}: {
  children: React.ReactNode;
  variante?: "primario" | "secundario" | "perigo";
}) {
  const { pending } = useFormStatus();
  const cores = {
    primario: "bg-indigo-600 text-white hover:bg-indigo-700",
    secundario: "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
    perigo: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
  }[variante];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${cores}`}
    >
      {pending ? "Processando..." : children}
    </button>
  );
}

function Campo({
  item,
  value,
  onChange,
  readOnly,
}: {
  item: InventarioItem;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  const contado = value.trim() === "" ? null : parseFloat(value.replace(",", "."));
  const diff = contado === null || Number.isNaN(contado) ? null : contado - item.systemQty;

  return (
    <tr>
      <td className="px-4 py-2">
        <span className="font-medium text-slate-800">{item.name}</span>
        <span className="ml-2 text-xs text-slate-400">{item.sku}</span>
        {item.batchNumber && (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            lote {item.batchNumber}
            {item.expiresAt ? ` · val. ${item.expiresAt.split("-").reverse().join("/")}` : ""}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-slate-600">
        {fmt(item.systemQty)}{" "}
        <span className="text-xs text-slate-400">{item.unitKey ?? "un"}</span>
      </td>
      <td className="px-4 py-2">
        <input
          name={`count:${item.itemId}`}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="—"
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2 text-right text-sm font-medium">
        {diff === null ? (
          <span className="text-slate-400">—</span>
        ) : diff === 0 ? (
          <span className="text-slate-400">0</span>
        ) : diff > 0 ? (
          <span className="text-emerald-600">+{fmt(diff)}</span>
        ) : (
          <span className="text-rose-600">{fmt(diff)}</span>
        )}
      </td>
    </tr>
  );
}

export function InventarioContagem({
  inventoryId,
  warehouseName,
  notes,
  itens,
  podeContar,
}: {
  inventoryId: string;
  warehouseName: string;
  notes: string | null;
  itens: InventarioItem[];
  podeContar: boolean;
}) {
  const [salvarState, salvarAction] = useActionState<InventarioFormState, FormData>(
    _salvarContagem,
    null,
  );
  const [aplicarState, aplicarAction] = useActionState<InventarioFormState, FormData>(
    _aplicarContagem,
    null,
  );
  const [descartarState, descartarAction] = useActionState<
    InventarioFormState,
    FormData
  >(_descartarInventario, null);

  const [contagens, setContagens] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      itens.map((i) => [i.itemId, i.countedQty === null ? "" : String(i.countedQty)]),
    ),
  );

  const alterados = itens.filter((i) => {
    const v = contagens[i.itemId]?.trim();
    if (!v) return false;
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) && n !== i.systemQty;
  });
  const pendentes = itens.filter((i) => !contagens[i.itemId]?.trim()).length;
  const divergentes = alterados.length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Inventário em aberto — {warehouseName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {itens.length} item(ns) com saldo
            {notes ? ` · ${notes}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-600">
            {pendentes} não contado(s)
          </span>
          <span className="rounded bg-amber-50 px-2 py-1 font-medium text-amber-700">
            {divergentes} divergente(s)
          </span>
        </div>
      </div>

      <form action={salvarAction} className="px-4 py-4">
        <input type="hidden" name="inventoryId" value={inventoryId} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 text-right font-medium">Saldo do sistema</th>
                <th className="px-4 py-2 font-medium">Contagem</th>
                <th className="px-4 py-2 text-right font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itens.map((i) => (
                <Campo
                  key={i.itemId}
                  item={i}
                  value={contagens[i.itemId] ?? ""}
                  readOnly={!podeContar}
                  onChange={(v) => setContagens((c) => ({ ...c, [i.itemId]: v }))}
                />
              ))}
            </tbody>
          </table>
        </div>

        {itens.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">
            Nenhum saldo neste depósito — nada a contar.
          </p>
        )}

        {podeContar && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Botao variante="secundario">Salvar contagem</Botao>
            <button
              type="submit"
              formAction={aplicarAction}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              Aplicar ajustes
            </button>
            <span className="text-xs text-slate-400">
              Aplicar gera os movimentos de ajuste e fecha o inventário.
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium">
          {salvarState?.error && <span className="text-rose-600">{salvarState.error}</span>}
          {salvarState?.ok && (
            <span className="text-emerald-600">{salvarState.message}</span>
          )}
          {aplicarState?.error && (
            <span className="text-rose-600">{aplicarState.error}</span>
          )}
          {aplicarState?.ok && (
            <span className="text-emerald-600">{aplicarState.message}</span>
          )}
        </div>
      </form>

      {podeContar && (
        <div className="border-t border-slate-100 px-4 py-3">
          <form
            action={descartarAction}
            className="flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="inventoryId" value={inventoryId} />
            <Botao variante="perigo">Descartar inventário</Botao>
            <span className="text-xs text-slate-400">
              Descartar remove a contagem sem gerar movimento.
            </span>
            {descartarState?.error && (
              <span className="text-xs font-medium text-rose-600">
                {descartarState.error}
              </span>
            )}
            {descartarState?.ok && (
              <span className="text-xs font-medium text-emerald-600">
                {descartarState.message}
              </span>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
