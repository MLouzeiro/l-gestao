import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateOnly, formatDateTime, todayInputValue } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getAccountDetail } from "@/server/modules/financeiro/financial.service";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { DIRECTION_LABELS, StatusBadge } from "@/components/financeiro/status-badge";
import { BaixaForm } from "@/components/financeiro/baixa-form";

const ORIGEM: Record<string, string> = {
  SALE: "Venda",
  PURCHASE: "Compra",
  RETURN: "Devolução",
  MANUAL: "Lançamento manual",
};

export default async function ContaFinanceiraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, role } = await requirePermission("finance.view");
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const conta = await withTenant(tenantId, (tx) => getAccountDetail(tx, tenantId, id));
  if (!conta) notFound();

  const canPay =
    resolvePermissions(role).includes("finance.payments") &&
    conta.status !== "PAID" &&
    conta.status !== "CANCELLED";
  const saldo = conta.amountCents - conta.paidCents;

  const cards: { label: string; value: string }[] = [
    { label: "Valor", value: formatBRL(conta.amountCents) },
    { label: "Pago", value: conta.paidCents > 0 ? formatBRL(conta.paidCents) : "—" },
    { label: "Saldo", value: saldo > 0 ? formatBRL(saldo) : "—" },
    { label: "Vencimento", value: formatDateOnly(conta.dueDate) },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">
              {conta.description}
            </h1>
            <StatusBadge status={conta.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {DIRECTION_LABELS[conta.direction]}
            {conta.installmentNumber && conta.installmentCount
              ? ` · parcela ${conta.installmentNumber}/${conta.installmentCount}`
              : ""}
            {" · "}
            {ORIGEM[conta.source] ?? conta.source}
            {conta.source === "SALE" && conta.sourceId && (
              <>
                {" · "}
                <Link
                  href={`/vendas/${conta.sourceId}`}
                  className="text-indigo-600 hover:text-indigo-800"
                >
                  Ver venda
                </Link>
              </>
            )}
            {conta.partyName ? ` · ${conta.partyName}` : ""}
          </p>
        </div>
        <Link
          href="/financeiro"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          ← Voltar
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-800">{c.value}</p>
          </div>
        ))}
      </div>

      {conta.notes && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Observações</p>
          <p className="mt-1 text-sm text-slate-700">{conta.notes}</p>
        </div>
      )}

      {canPay && (
        <BaixaForm accountId={conta.id} saldoCents={saldo} hoje={todayInputValue()} />
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
          Histórico de pagamentos
        </h2>
        {conta.payments.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Nenhuma baixa registrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Forma</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-right font-medium">Juros</th>
                  <th className="px-4 py-2 text-right font-medium">Desconto</th>
                  <th className="px-4 py-2 font-medium">Obs.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {conta.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-slate-600">{formatDateOnly(p.paidAt)}</td>
                    <td className="px-4 py-2 text-slate-700">{p.paymentMethod}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">
                      {formatBRL(p.amountCents)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {p.interestCents > 0 ? formatBRL(p.interestCents) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {p.discountCents > 0 ? formatBRL(p.discountCents) : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{p.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              Registros imutáveis — correção de baixa é feita por estorno (v2).
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
