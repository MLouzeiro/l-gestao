import { headers } from "next/headers";
import { auth } from "@/server/auth";

const modules = [
  { name: "Estoque", desc: "Produtos, lotes, entradas e saídas", status: "Concluído" },
  { name: "Vendas", desc: "Pedidos, faturamento e devoluções", status: "Concluído" },
  { name: "Compras", desc: "Notas de entrada e contas a pagar", status: "Concluído" },
  { name: "Financeiro", desc: "Contas a receber e a pagar", status: "Concluído" },
  { name: "Relatórios", desc: "Indicadores e exportação CSV", status: "Concluído" },
  { name: "Administração", desc: "Equipe, papéis, convites e 2FA", status: "Concluído" },
  { name: "Auditoria", desc: "Histórico de alterações sensíveis", status: "Fase 13" },
];

const roadmap = [
  { phase: "Fase 1", label: "Arquitetura aprovada", done: true },
  { phase: "Fase 2", label: "Banco de dados + RLS multi-empresa", done: true },
  { phase: "Fase 3", label: "Login e sessão", done: true },
  { phase: "Fase 4", label: "Empresas e configurações", done: true },
  { phase: "Fase 5", label: "Usuários, papéis e convites", done: true },
  { phase: "Fase 6", label: "Estoque: saldo, custo médio e movimentações", done: true },
  { phase: "Fase 7", label: "Produtos: catálogo, categorias, marcas e kits", done: true },
  { phase: "Fase 8", label: "Lotes: validade, FEFO e bloqueio de vencido", done: true },
  { phase: "Fase 9", label: "Inventário: contagem e ajuste de saldo", done: true },
  { phase: "Fase 10", label: "Vendas: pedidos, faturamento e devoluções", done: true },
  { phase: "Fase 11", label: "Financeiro: recebimentos, compras e vencidas", done: true },
  { phase: "Fase 12", label: "Relatórios: indicadores e exportação CSV", done: true },
];

export default async function PainelPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const firstName = session?.user.name.split(" ")[0] ?? "tudo bem";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Olá, {firstName}!
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Sistema multi-empresa de estoque, vendas e financeiro — etapa inicial.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {modules.map((m) => (
          <div
            key={m.name}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">
                {m.name}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  m.status === "Concluído"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {m.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{m.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800">
          Progresso da implantação
        </h2>
        <ul className="mt-3 space-y-2">
          {roadmap.map((r) => (
            <li key={r.phase} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  r.done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {r.done ? "✓" : "·"}
              </span>
              <span className="font-medium text-slate-500">{r.phase}</span>
              <span className={r.done ? "text-slate-700" : "text-slate-400"}>
                {r.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
