"use client";

import { useEffect, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  _buscarLotes,
  _movimentar,
  type EstoqueFormState,
  type LoteInfo,
} from "@/actions/estoque";

type Produto = {
  id: string;
  sku: string;
  name: string;
  trackBatch: boolean;
};

type Deposito = { id: string; name: string };

const TIPOS: { value: string; label: string; grupo: "Entradas" | "Saídas" }[] = [
  { value: "ENTRADA_COMPRA", label: "Entrada — Compra", grupo: "Entradas" },
  { value: "ENTRADA_DEVOLUCAO", label: "Entrada — Devolução de cliente", grupo: "Entradas" },
  { value: "ENTRADA_AJUSTE", label: "Entrada — Ajuste (+)", grupo: "Entradas" },
  { value: "SAIDA_VENDA", label: "Saída — Venda", grupo: "Saídas" },
  { value: "SAIDA_DEVOLUCAO_FORNECEDOR", label: "Saída — Devolução p/ fornecedor", grupo: "Saídas" },
  { value: "SAIDA_PERDA", label: "Saída — Perda", grupo: "Saídas" },
  { value: "SAIDA_QUEBRA", label: "Saída — Quebra", grupo: "Saídas" },
  { value: "SAIDA_VENCIMENTO", label: "Saída — Vencimento", grupo: "Saídas" },
  { value: "SAIDA_AJUSTE", label: "Saída — Ajuste (−)", grupo: "Saídas" },
];

const ENTRADAS = new Set(
  TIPOS.filter((t) => t.grupo === "Entradas").map((t) => t.value),
);

function Botao({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Registrando..." : children}
    </button>
  );
}

export function MovimentacaoForm({
  produtos,
  depositos,
  fefo,
  bloqueioVencido,
}: {
  produtos: Produto[];
  depositos: Deposito[];
  fefo: boolean;
  bloqueioVencido: boolean;
}) {
  const [state, formAction] = useActionState<EstoqueFormState, FormData>(
    _movimentar,
    null,
  );
  const [tipo, setTipo] = useState("ENTRADA_COMPRA");
  const [produtoId, setProdutoId] = useState("");
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [lotes, setLotes] = useState<LoteInfo[]>([]);

  const produto = produtos.find((p) => p.id === produtoId);
  const isEntrada = ENTRADAS.has(tipo);
  const mostraLote = produto?.trackBatch ?? false;

  // Saída de produto com lote: carrega os lotes (ordenados FEFO) do
  // depósito selecionado para o usuário escolher — ou deixar o automático.
  useEffect(() => {
    if (mostraLote && !isEntrada && produtoId && depositoId) {
      let vivo = true;
      _buscarLotes(produtoId, depositoId)
        .then((rows) => {
          if (vivo) setLotes(rows);
        })
        .catch(() => {
          if (vivo) setLotes([]);
        });
      return () => {
        vivo = false;
      };
    }
    setLotes([]);
    return;
  }, [mostraLote, isEntrada, produtoId, depositoId]);

  if (produtos.length === 0 || depositos.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        {depositos.length === 0
          ? "Nenhum depósito cadastrado."
          : "Cadastre um produto abaixo para começar a movimentar."}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Nova movimentação
      </h2>
      <form action={formAction} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        <label className="col-span-2 text-xs font-medium text-slate-500">
          Tipo
          <select
            name="type"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            <optgroup label="Entradas">
              {TIPOS.filter((t) => t.grupo === "Entradas").map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Saídas">
              {TIPOS.filter((t) => t.grupo === "Saídas").map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="col-span-2 text-xs font-medium text-slate-500">
          Produto
          <select
            name="productId"
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            <option value="">Selecione...</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-1 text-xs font-medium text-slate-500">
          Depósito
          <select
            name="warehouseId"
            required
            value={depositoId}
            onChange={(e) => setDepositoId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            {depositos.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-1 text-xs font-medium text-slate-500">
          Quantidade
          <input
            name="quantity"
            required
            inputMode="decimal"
            placeholder="10"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>

        {isEntrada && (
          <label className="col-span-2 text-xs font-medium text-slate-500">
            Custo unitário (R$)
            <input
              name="unitCost"
              required
              inputMode="decimal"
              placeholder="10,50"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>
        )}

        {mostraLote && isEntrada && (
          <>
            <label className="col-span-2 text-xs font-medium text-slate-500">
              Número do lote *
              <input
                name="batchNumber"
                required
                placeholder="L001"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
              />
            </label>
            <label className="col-span-2 text-xs font-medium text-slate-500">
              Validade do lote
              <input
                name="batchExpiresAt"
                type="date"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
              />
            </label>
          </>
        )}

        {mostraLote && !isEntrada && (
          <label className="col-span-2 text-xs font-medium text-slate-500">
            Lote {fefo ? "" : "*"}
            <select
              name="batchNumber"
              required={!fefo}
              defaultValue=""
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            >
              <option value="">
                {fefo
                  ? "— automático (FEFO: validade mais próxima) —"
                  : "Selecione o lote..."}
              </option>
              {lotes.map((l) => (
                <option
                  key={l.batchNumber}
                  value={l.batchNumber}
                  disabled={l.vencido && bloqueioVencido}
                >
                  {l.batchNumber} —{" "}
                  {l.expiresAt
                    ? `vence ${l.expiresAt.split("-").reverse().join("/")}`
                    : "sem validade"}{" "}
                  ({l.available} un)
                  {l.vencido ? " · VENCIDO" : ""}
                </option>
              ))}
            </select>
            {fefo && (
              <span className="mt-1 block font-normal normal-case text-slate-400">
                {lotes.length === 0
                  ? "Nenhum lote com saldo neste depósito."
                  : "Em automático, o sistema usa o lote de validade mais próxima."}
              </span>
            )}
            {!fefo && lotes.some((l) => l.vencido) && bloqueioVencido && (
              <span className="mt-1 block font-normal normal-case text-amber-600">
                Lotes vencidos estão bloqueados para venda pela configuração.
              </span>
            )}
          </label>
        )}

        <label className="col-span-2 text-xs font-medium text-slate-500">
          Motivo / observação (opcional)
          <input
            name="reason"
            maxLength={500}
            placeholder="NF 123, contagem, ..."
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>

        <div className="col-span-2 flex items-end gap-3 md:col-span-6">
          <Botao>Registrar movimentação</Botao>
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
