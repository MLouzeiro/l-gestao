"use client";

import { useState } from "react";
import { toCents, formatBRL } from "@/lib/money";
import { _abrirCaixa, _fecharCaixa, _sangria, _suprimento } from "@/actions/pdv";
import type { CashSummary } from "@/server/modules/pdv/cash.service";

// Modais de caixa: abrir (fundo de troco), fechar (contagem por forma),
// suprimento e sangria. Valores digitados em reais ("1.234,56") e convertidos
// em centavos no servidor via toCents — nunca float.

export type CashModalKind = "abrir" | "fechar" | "suprimento" | "sangria";

type Props = {
  kind: CashModalKind;
  cash: CashSummary;
  onClose: () => void;
  onDone: (message: string) => void;
};

function parseMoneyInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return 0;
  try {
    return toCents(t);
  } catch {
    return null;
  }
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-lg font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
      />
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function CashModal({ kind, cash, onClose, onDone }: Props) {
  const [fundo, setFundo] = useState("0,00");
  const [valor, setValor] = useState("0,00");
  const [descricao, setDescricao] = useState("");
  const [dinheiro, setDinheiro] = useState("0,00");
  const [cartao, setCartao] = useState("0,00");
  const [pix, setPix] = useState("0,00");
  const [outros, setOutros] = useState("0,00");
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (kind === "abrir") {
        const cents = parseMoneyInput(fundo);
        if (cents == null) return setError("Valor de abertura inválido.");
        const res = await _abrirCaixa({
          openingAmountCents: cents,
          notes: obs || undefined,
        });
        if (!res.ok) return setError(res.error);
        onDone(`Caixa #${res.data.number} aberto.`);
        return;
      }
      if (kind === "fechar") {
        const c = parseMoneyInput(dinheiro);
        const cc = parseMoneyInput(cartao);
        const cp = parseMoneyInput(pix);
        const co = parseMoneyInput(outros);
        if (c == null || cc == null || cp == null || co == null) {
          return setError("Contagem inválida.");
        }
        const res = await _fecharCaixa({
          countedCashCents: c,
          countedCardCents: cc,
          countedPixCents: cp,
          countedOtherCents: co,
          notes: obs || undefined,
        });
        if (!res.ok) return setError(res.error);
        const dif = res.data.differenceCents;
        onDone(
          `Caixa fechado — diferença ${formatBRL(dif)} ${
            dif === 0 ? "(conferido)" : dif > 0 ? "(sobra)" : "(faltou)"
          }.`,
        );
        return;
      }
      const cents = parseMoneyInput(valor);
      if (cents == null || cents <= 0) return setError("Valor inválido.");
      const res =
        kind === "suprimento"
          ? await _suprimento({
              amountCents: cents,
              description: descricao || undefined,
            })
          : await _sangria({
              amountCents: cents,
              description: descricao || undefined,
            });
      if (!res.ok) return setError(res.error);
      onDone(
        `${kind === "suprimento" ? "Suprimento" : "Sangria"} de ${formatBRL(
          cents,
        )} lançado.`,
      );
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    kind === "abrir"
      ? "Abrir caixa"
      : kind === "fechar"
        ? "Fechar caixa"
        : kind === "suprimento"
          ? "Suprimento de caixa"
          : "Sangria de caixa";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-slate-800">{title}</h2>

        {kind === "abrir" && (
          <div className="space-y-3">
            <MoneyField
              label="Fundo de troco (R$)"
              value={fundo}
              onChange={setFundo}
            />
            <label className="block">
              <span className="text-xs font-bold uppercase text-slate-500">
                Observação
              </span>
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800"
              />
            </label>
          </div>
        )}

        {kind === "fechar" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Esperado em dinheiro:{" "}
              <strong>{formatBRL(cash.expected.cash)}</strong>
              {cash.open ? ` (caixa #${cash.number})` : ""}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <MoneyField label="Dinheiro (R$)" value={dinheiro} onChange={setDinheiro} />
              <MoneyField label="Cartão (R$)" value={cartao} onChange={setCartao} />
              <MoneyField label="PIX (R$)" value={pix} onChange={setPix} />
              <MoneyField label="Outros (R$)" value={outros} onChange={setOutros} />
            </div>
            <label className="block">
              <span className="text-xs font-bold uppercase text-slate-500">
                Observação
              </span>
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800"
              />
            </label>
          </div>
        )}

        {(kind === "suprimento" || kind === "sangria") && (
          <div className="space-y-3">
            <MoneyField
              label={`Valor (R$) — esperado em caixa ${formatBRL(cash.expected.cash)}`}
              value={valor}
              onChange={setValor}
            />
            <label className="block">
              <span className="text-xs font-bold uppercase text-slate-500">
                Descrição
              </span>
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={kind === "suprimento" ? "Troco extra" : "Depósito bancário"}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800"
              />
            </label>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2 font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded-lg bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
