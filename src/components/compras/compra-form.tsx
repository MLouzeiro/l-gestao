"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { _salvarCompra, type CompraFormState } from "@/actions/compras";
import { formatBRL, toCents } from "@/lib/money";
import { todayInputValue } from "@/lib/dates";

type Opcao = { id: string; name: string };
type Produto = { id: string; sku: string; name: string; trackBatch: boolean };

export type CompraInicial = {
  purchaseId: string;
  supplierId: string;
  warehouseId: string;
  entryDate: string; // YYYY-MM-DD
  documentNumber: string | null;
  notes: string | null;
  installments: number;
  items: {
    productId: string;
    quantity: number;
    unitCostCents: number;
    batchNumber: string | null;
    expiresAt: string | null; // YYYY-MM-DD ou null
  }[];
};

type ItemLinha = {
  key: number;
  productId: string;
  quantity: string;
  cost: string;
  batchNumber: string;
  expiresAt: string;
};

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function parseCents(value: string): number | null {
  const s = value.trim();
  if (!s) return 0;
  try {
    return toCents(s);
  } catch {
    return null;
  }
}

function parseQty(value: string): number | null {
  const s = value.trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

export function CompraForm({
  fornecedores,
  depositos,
  produtos,
  initial,
}: {
  fornecedores: Opcao[];
  depositos: Opcao[];
  produtos: Produto[];
  initial: CompraInicial | null;
}) {
  const [state, formAction] = useActionState<CompraFormState, FormData>(
    _salvarCompra,
    null,
  );
  const router = useRouter();

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(
    initial?.warehouseId ?? depositos[0]?.id ?? "",
  );
  const [entryDate, setEntryDate] = useState(
    initial?.entryDate ?? todayInputValue(),
  );
  const [documentNumber, setDocumentNumber] = useState(
    initial?.documentNumber ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [installments, setInstallments] = useState(initial?.installments ?? 1);
  const [items, setItems] = useState<ItemLinha[]>(() =>
    (initial?.items ?? []).map((i, idx) => ({
      key: idx,
      productId: i.productId,
      quantity: String(i.quantity),
      cost: centsToText(i.unitCostCents),
      batchNumber: i.batchNumber ?? "",
      expiresAt: i.expiresAt ?? "",
    })),
  );
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok && state.purchaseId) {
      router.push(`/compras/${state.purchaseId}`);
    }
  }, [state, router]);

  const linhas = useMemo(
    () =>
      items.map((i) => {
        const qtd = parseQty(i.quantity);
        const custoCents = parseCents(i.cost);
        const produto = produtos.find((p) => p.id === i.productId);
        const exigeLote = produto?.trackBatch ?? false;
        const loteOk = !exigeLote || i.batchNumber.trim().length > 0;
        const validadeOk = !exigeLote || /^\d{4}-\d{2}-\d{2}$/.test(i.expiresAt);
        const valido =
          qtd !== null && custoCents !== null && custoCents >= 0 && loteOk && validadeOk;
        const subtotal = valido ? Math.round(qtd! * custoCents!) : 0;
        return { ...i, qtd, custoCents, exigeLote, valido, subtotal };
      }),
    [items, produtos],
  );

  const previa = useMemo(() => {
    let total = 0;
    for (const l of linhas) total += l.subtotal;
    return { total, invalida: linhas.some((l) => !l.valido) };
  }, [linhas]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        purchaseId: initial?.purchaseId,
        supplierId,
        warehouseId,
        entryDate: entryDate || null,
        documentNumber: documentNumber.trim() || null,
        notes: notes.trim() || undefined,
        installments,
        items: linhas
          .filter((l) => l.valido)
          .map((l) => ({
            productId: l.productId,
            quantity: l.qtd,
            unitCostCents: l.custoCents,
            batchNumber: l.exigeLote ? l.batchNumber.trim() : null,
            expiresAt: l.exigeLote && l.expiresAt ? l.expiresAt : null,
          })),
      }),
    [
      initial?.purchaseId,
      supplierId,
      warehouseId,
      entryDate,
      documentNumber,
      notes,
      installments,
      linhas,
    ],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setErroLocal(null);
    if (!supplierId) {
      e.preventDefault();
      setErroLocal("Selecione o fornecedor.");
      return;
    }
    if (!warehouseId) {
      e.preventDefault();
      setErroLocal("Selecione o depósito.");
      return;
    }
    if (linhas.length === 0) {
      e.preventDefault();
      setErroLocal("Adicione ao menos um item.");
      return;
    }
    if (previa.invalida) {
      e.preventDefault();
      setErroLocal(
        "Corrija os itens: quantidade/custo inválidos ou lote/validade faltando.",
      );
      return;
    }
  }

  function addItem() {
    const primeiro = produtos[0];
    setItems((prev) => [
      ...prev,
      {
        key: prev.reduce((max, i) => Math.max(max, i.key), -1) + 1,
        productId: primeiro?.id ?? "",
        quantity: "1",
        cost: "",
        batchNumber: "",
        expiresAt: "",
      },
    ]);
  }

  function changeItem(key: number, patch: Partial<ItemLinha>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function removeItem(key: number) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  if (produtos.length === 0 || depositos.length === 0 || fornecedores.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        {fornecedores.length === 0
          ? "Cadastre um fornecedor antes de registrar uma compra."
          : depositos.length === 0
            ? "Nenhum depósito cadastrado."
            : "Cadastre um produto antes de registrar uma compra."}
      </p>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Dados da compra</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-slate-500">
            Fornecedor *
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              <option value="">Selecione...</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Depósito *
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              <option value="">Selecione...</option>
              {depositos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Data de entrada
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>

          <label className="text-xs font-medium text-slate-500">
            Documento (NF / pedido)
            <input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              maxLength={100}
              placeholder="NF-e 12345"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>

          <label className="text-xs font-medium text-slate-500">
            Parcelas (a pagar)
            <select
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1x à vista" : `${n}x`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Observação
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="Condições do fornecedor..."
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Itens</h2>
          <button
            type="button"
            onClick={addItem}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Adicionar item
          </button>
        </div>

        {linhas.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Nenhum item — adicione ao menos um.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Qtd</th>
                  <th className="px-4 py-2 text-right font-medium">Custo unit.</th>
                  <th className="px-4 py-2 font-medium">Lote</th>
                  <th className="px-4 py-2 font-medium">Validade</th>
                  <th className="px-4 py-2 text-right font-medium">Subtotal</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.map((l) => (
                  <tr key={l.key}>
                    <td className="px-4 py-2">
                      <select
                        value={l.productId}
                        onChange={(e) =>
                          changeItem(l.key, { productId: e.target.value })
                        }
                        className="w-full min-w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                      >
                        <option value="">Selecione...</option>
                        {produtos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        value={l.quantity}
                        onChange={(e) =>
                          changeItem(l.key, { quantity: e.target.value })
                        }
                        inputMode="decimal"
                        className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        value={l.cost}
                        onChange={(e) => changeItem(l.key, { cost: e.target.value })}
                        inputMode="decimal"
                        placeholder="0,00"
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800"
                      />
                    </td>
                    <td className="px-4 py-2">
                      {l.exigeLote ? (
                        <input
                          value={l.batchNumber}
                          onChange={(e) =>
                            changeItem(l.key, { batchNumber: e.target.value })
                          }
                          maxLength={100}
                          placeholder="obrigatório"
                          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {l.exigeLote ? (
                        <input
                          type="date"
                          value={l.expiresAt}
                          onChange={(e) =>
                            changeItem(l.key, { expiresAt: e.target.value })
                          }
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-medium text-slate-800">
                      {l.valido ? formatBRL(l.subtotal) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(l.key)}
                        aria-label="Remover item"
                        className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Total estimado:{" "}
          <span className="font-semibold text-slate-900">
            {formatBRL(previa.total)}
          </span>
          <span className="ml-2 text-xs text-slate-400">
            · a pagar em {installments}x
          </span>
        </div>
        <div className="flex items-center gap-3">
          {(erroLocal || state?.error) && (
            <span className="text-xs font-medium text-red-600">
              {erroLocal ?? state?.error}
            </span>
          )}
          {state?.ok && !erroLocal && (
            <span className="text-xs font-medium text-emerald-600">
              {state.message}
            </span>
          )}
          <Botao>{initial ? "Salvar alterações" : "Criar nota"}</Botao>
        </div>
      </div>
    </form>
  );
}
