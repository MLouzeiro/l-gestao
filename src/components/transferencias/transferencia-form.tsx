"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  _criarTransferencia,
  type TransferenciaActionResult,
} from "@/actions/transferencias";

type Opcao = { id: string; name: string };
type Produto = { id: string; sku: string; name: string; trackBatch: boolean };

type ItemLinha = {
  key: number;
  productId: string;
  quantity: string;
  batchNumber: string;
};

function parseQty(value: string): number | null {
  const s = value.trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function TransferenciaForm({
  depositos,
  produtos,
}: {
  depositos: Opcao[];
  produtos: Produto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [de, setDe] = useState(depositos[0]?.id ?? "");
  const [para, setPara] = useState(depositos[1]?.id ?? "");
  const [settleOn, setSettleOn] = useState<"SEND" | "RECEIVE">("SEND");
  const [immediate, setImmediate] = useState(false);
  const [itens, setItens] = useState<ItemLinha[]>([
    { key: 1, productId: "", quantity: "", batchNumber: "" },
  ]);

  function addItem(): void {
    setItens((prev) => [
      ...prev,
      {
        key: (prev.at(-1)?.key ?? 0) + 1,
        productId: "",
        quantity: "",
        batchNumber: "",
      },
    ]);
  }

  function removeItem(key: number): void {
    setItens((prev) =>
      prev.length > 1 ? prev.filter((i) => i.key !== key) : prev,
    );
  }

  function setItem(key: number, patch: Partial<ItemLinha>): void {
    setItens((prev) =>
      prev.map((i) => (i.key === key ? { ...i, ...patch } : i)),
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const linhas = itens.map((i) => ({
      productId: i.productId,
      batchNumber: i.batchNumber.trim() || null,
      quantity: parseQty(i.quantity),
    }));
    if (linhas.some((l) => !l.productId || l.quantity === null)) {
      setError("Preencha produto e quantidade em todos os itens.");
      return;
    }

    startTransition(async () => {
      const res: TransferenciaActionResult<{ id: string }> =
        await _criarTransferencia({
          fromWarehouseId: de,
          toWarehouseId: para,
          settleOn,
          immediate,
          items: linhas.map((l) => ({
            productId: l.productId,
            batchNumber: l.batchNumber,
            quantity: l.quantity,
          })),
        });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(`/transferencias/${res.data.id}`);
      router.refresh();
    });
  }

  const err = (k: string): string | undefined => fieldErrors[k]?.[0];

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Origem *
          </label>
          <select
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Destino *
          </label>
          <select
            value={para}
            onChange={(e) => setPara(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {err("toWarehouseId") && (
            <p className="mt-1 text-xs text-rose-600">{err("toWarehouseId")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Baixa na origem
          </label>
          <select
            value={settleOn}
            onChange={(e) =>
              setSettleOn(e.target.value as "SEND" | "RECEIVE")
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="SEND">Ao enviar (material sai já)</option>
            <option value="RECEIVE">Ao receber (sai na confirmação)</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h3 className="text-xs font-semibold text-slate-700">Itens</h3>
          <button
            type="button"
            onClick={addItem}
            className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
          >
            + adicionar item
          </button>
        </div>
        <div className="space-y-2 p-3">
          {itens.map((item) => {
            const produto = produtos.find((p) => p.id === item.productId);
            return (
              <div
                key={item.key}
                className="grid items-end gap-2 sm:grid-cols-12"
              >
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-[11px] text-slate-500">
                    Produto
                  </label>
                  <select
                    value={item.productId}
                    onChange={(e) =>
                      setItem(item.key, { productId: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">selecione…</option>
                    {produtos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] text-slate-500">
                    Qtd.
                  </label>
                  <input
                    value={item.quantity}
                    onChange={(e) =>
                      setItem(item.key, { quantity: e.target.value })
                    }
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-[11px] text-slate-500">
                    Lote {produto?.trackBatch ? "*" : "(opcional)"}
                  </label>
                  <input
                    value={item.batchNumber}
                    onChange={(e) =>
                      setItem(item.key, { batchNumber: e.target.value })
                    }
                    placeholder={produto?.trackBatch ? "obrigatório" : "—"}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    className="rounded px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {err("items") && (
        <p className="text-xs text-rose-600">{err("items")}</p>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={immediate}
          onChange={(e) => setImmediate(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Executar agora (envio e recebimento imediatos — fluxo simples)
      </label>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Criar transferência"}
      </button>
    </form>
  );
}
