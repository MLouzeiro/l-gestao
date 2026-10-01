"use client";

import { useEffect, useMemo, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { _salvarVenda, type VendaFormState } from "@/actions/vendas";
import { formatBRL, toCents } from "@/lib/money";
import { resolveProductByCode } from "@/lib/sale-scan";

type Produto = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  salePriceCents: number;
};
type Opcao = { id: string; name: string };
type Vendedor = { userId: string; name: string; email: string };

type ItemLinha = {
  key: number;
  productId: string;
  quantity: string;
  price: string;
  discount: string;
};

export type VendaInicial = {
  saleId: string;
  warehouseId: string;
  customerId: string | null;
  sellerId: string | null;
  notes: string | null;
  orderDiscountCents: number;
  items: {
    productId: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
  }[];
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

export function VendaForm({
  depositos,
  produtos,
  clientes,
  vendedores,
  canDiscount,
  initial,
}: {
  depositos: Opcao[];
  produtos: Produto[];
  clientes: Opcao[];
  vendedores: Vendedor[];
  canDiscount: boolean;
  initial: VendaInicial | null;
}) {
  const [state, formAction] = useActionState<VendaFormState, FormData>(
    _salvarVenda,
    null,
  );
  const router = useRouter();

  const [warehouseId, setWarehouseId] = useState(
    initial?.warehouseId ?? depositos[0]?.id ?? "",
  );
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [sellerId, setSellerId] = useState(initial?.sellerId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [orderDiscount, setOrderDiscount] = useState(
    initial ? centsToText(initial.orderDiscountCents) : "",
  );
  const [items, setItems] = useState<ItemLinha[]>(() =>
    (initial?.items ?? []).map((i, idx) => ({
      key: idx,
      productId: i.productId,
      quantity: String(i.quantity),
      price: centsToText(i.unitPriceCents),
      discount: centsToText(i.discountCents),
    })),
  );
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [codigoBarras, setCodigoBarras] = useState("");
  const [scanMsg, setScanMsg] = useState<{
    tipo: "ok" | "erro";
    texto: string;
  } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      router.push(state.saleId ? `/vendas/${state.saleId}` : "/vendas");
    }
  }, [state, router]);

  const linhas = useMemo(
    () =>
      items.map((i) => {
        const qtd = parseQty(i.quantity);
        const precoCents = parseCents(i.price);
        const descCents = parseCents(i.discount);
        const valido =
          qtd !== null &&
          precoCents !== null &&
          descCents !== null &&
          descCents >= 0;
        const subtotal = valido ? Math.round(qtd! * precoCents!) : 0;
        const desconto = valido ? Math.min(descCents!, subtotal) : 0;
        return { ...i, qtd, precoCents, descCents, valido, subtotal, desconto };
      }),
    [items],
  );

  const previa = useMemo(() => {
    let subtotal = 0;
    let descontoItens = 0;
    for (const l of linhas) {
      subtotal += l.subtotal;
      descontoItens += l.desconto;
    }
    const descontoPedido = Math.max(
      Math.min(parseCents(orderDiscount) ?? 0, subtotal - descontoItens),
      0,
    );
    return {
      subtotal,
      descontoItens,
      descontoPedido,
      total: Math.max(subtotal - descontoItens - descontoPedido, 0),
      invalida: linhas.some((l) => !l.valido),
    };
  }, [linhas, orderDiscount]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        saleId: initial?.saleId,
        warehouseId,
        customerId: customerId || null,
        sellerId: sellerId || null,
        notes: notes.trim() || undefined,
        orderDiscountCents: canDiscount
          ? parseCents(orderDiscount) ?? 0
          : 0,
        items: linhas
          .filter((l) => l.valido)
          .map((l) => ({
            productId: l.productId,
            quantity: l.qtd,
            unitPriceCents: l.precoCents,
            discountCents: l.descCents,
          })),
      }),
    [
      initial?.saleId,
      warehouseId,
      customerId,
      sellerId,
      notes,
      canDiscount,
      orderDiscount,
      linhas,
    ],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setErroLocal(null);
    if (!warehouseId) {
      e.preventDefault();
      setErroLocal("Selecione o depósito.");
      return;
    }
    if (items.length === 0) {
      e.preventDefault();
      setErroLocal("Adicione ao menos um item.");
      return;
    }
    if (previa.invalida) {
      e.preventDefault();
      setErroLocal("Corrija a quantidade/preço inválidos nos itens.");
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
        price: primeiro ? centsToText(primeiro.salePriceCents) : "0,00",
        discount: "",
      },
    ]);
  }

  function changeItem(key: number, patch: Partial<ItemLinha>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function onProductChange(key: number, productId: string) {
    const produto = produtos.find((p) => p.id === productId);
    changeItem(key, {
      productId,
      price: produto ? centsToText(produto.salePriceCents) : "",
    });
  }

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const resolucao = resolveProductByCode(produtos, codigoBarras);
    setCodigoBarras("");
    if (!resolucao) return;
    if (resolucao.status === "not_found") {
      setScanMsg({
        tipo: "erro",
        texto: `Produto não encontrado (código ${resolucao.code}).`,
      });
      scanRef.current?.focus();
      return;
    }
    const produto = resolucao.product;
    setItems((prev) => {
      const existente = prev.find((i) => i.productId === produto.id);
      if (existente) {
        const qtd = Number.parseFloat(existente.quantity.replace(",", "."));
        const atual = Number.isFinite(qtd) && qtd > 0 ? qtd : 0;
        return prev.map((i) =>
          i.productId === produto.id
            ? { ...i, quantity: String(atual + 1) }
            : i,
        );
      }
      return [
        ...prev,
        {
          key: prev.reduce((max, i) => Math.max(max, i.key), -1) + 1,
          productId: produto.id,
          quantity: "1",
          price: centsToText(produto.salePriceCents),
          discount: "",
        },
      ];
    });
    setScanMsg({ tipo: "ok", texto: `${produto.name} adicionado.` });
    scanRef.current?.focus();
  }

  if (produtos.length === 0 || depositos.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        {depositos.length === 0
          ? "Nenhum depósito cadastrado."
          : "Cadastre um produto antes de registrar uma venda."}
      </p>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Dados da venda</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
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
            Cliente
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              <option value="">— sem cliente —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Vendedor
            <select
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              <option value="">— não definido —</option>
              {vendedores.map((v) => (
                <option key={v.userId} value={v.userId}>
                  {v.name}
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
              placeholder="Pedido do cliente..."
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

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <label
            htmlFor="scan-codigo-barras"
            className="text-xs font-semibold text-slate-600"
          >
            Código de barras
          </label>
          <input
            id="scan-codigo-barras"
            ref={scanRef}
            value={codigoBarras}
            onChange={(e) => setCodigoBarras(e.target.value)}
            onKeyDown={onScanKeyDown}
            autoFocus
            placeholder="Leia com o leitor USB e pressione Enter"
            className="w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {scanMsg && (
            <span
              className={`text-xs font-medium ${
                scanMsg.tipo === "ok" ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {scanMsg.texto}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Nenhum item — adicione ao menos um produto.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Qtd</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Preço unit. (R$)
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Desconto (R$)
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Subtotal</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.map((l) => (
                  <tr key={l.key}>
                    <td className="px-4 py-2">
                      <select
                        value={l.productId}
                        onChange={(e) =>
                          onProductChange(l.key, e.target.value)
                        }
                        className="w-full min-w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                      >
                        <option value="">Selecione...</option>
                        {produtos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
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
                        value={l.price}
                        onChange={(e) =>
                          changeItem(l.key, { price: e.target.value })
                        }
                        inputMode="decimal"
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        value={l.discount}
                        onChange={(e) =>
                          changeItem(l.key, { discount: e.target.value })
                        }
                        inputMode="decimal"
                        placeholder="0,00"
                        disabled={!canDiscount}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">
                      {l.valido ? formatBRL(l.subtotal - l.desconto) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) => prev.filter((i) => i.key !== l.key))
                        }
                        className="text-xs font-medium text-rose-600 hover:text-rose-800"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 md:flex-row md:items-end md:justify-between">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumo label="Subtotal" valor={formatBRL(previa.subtotal)} />
          <Resumo
            label="Desconto itens"
            valor={`− ${formatBRL(previa.descontoItens)}`}
          />
          <label className="text-xs font-medium text-slate-500">
            Desconto pedido (R$)
            <input
              value={orderDiscount}
              onChange={(e) => setOrderDiscount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              disabled={!canDiscount}
              className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </label>
          <Resumo label="Total" valor={formatBRL(previa.total)} destaque />
        </div>

        <div className="flex flex-col items-start gap-2">
          <Botao>{initial ? "Salvar alterações" : "Criar venda"}</Botao>
          {(state?.error || erroLocal) && (
            <span className="text-xs font-medium text-red-600">
              {state?.error ?? erroLocal}
            </span>
          )}
          {state?.ok && state.message && (
            <span className="text-xs font-medium text-emerald-600">
              {state.message}
            </span>
          )}
          <span className="text-[11px] text-slate-400">
            Prévia dos valores — o servidor recalcula os totais ao salvar.
          </span>
        </div>
      </section>
    </form>
  );
}

function Resumo({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p
        className={`mt-0.5 font-semibold ${destaque ? "text-lg text-slate-900" : "text-sm text-slate-700"}`}
      >
        {valor}
      </p>
    </div>
  );
}
