"use client";

import { useActionState } from "react";
import { _registrarBaixa, type FinanceFormState } from "@/actions/financeiro";

// Formulário de baixa (parcial ou total) — o saldo vira default do valor;
// juros/desconto são informativos na v1 (não alteram o saldo).

const FORMAS = ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Transferência", "Boleto", "Outro"];

function ptBrCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function BaixaForm({
  accountId,
  saldoCents,
  hoje,
}: {
  accountId: string;
  saldoCents: number;
  hoje: string; // YYYY-MM-DD (local)
}) {
  const [state, formAction] = useActionState<FinanceFormState, FormData>(_registrarBaixa, null);

  return (
    <form
      action={formAction}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <input type="hidden" name="accountId" value={accountId} />

      <h2 className="text-sm font-semibold text-slate-800">Registrar baixa</h2>
      <p className="mt-1 text-xs text-slate-500">
        Saldo em aberto: R$ {ptBrCents(saldoCents)}.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <label className="text-xs font-medium text-slate-500">
          Valor (R$)
          <input
            name="amount"
            defaultValue={ptBrCents(saldoCents)}
            inputMode="decimal"
            required
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Juros (R$)
          <input
            name="interest"
            defaultValue="0,00"
            inputMode="decimal"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Desconto (R$)
          <input
            name="discount"
            defaultValue="0,00"
            inputMode="decimal"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Forma de pagamento
          <select
            name="paymentMethod"
            defaultValue="PIX"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            {FORMAS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">
          Data da baixa
          <input
            type="date"
            name="paidAt"
            defaultValue={hoje}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Observação
          <input
            name="notes"
            maxLength={500}
            placeholder="Opcional"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
      </div>

      {state?.error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Dar baixa
      </button>
    </form>
  );
}
