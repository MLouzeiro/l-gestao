"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  label: string;
  icon: string;
  href: string | null;
  module?: string;
  phase?: string;
};

type Section = {
  title: string;
  items: Item[];
};

// A sidebar só esconde o acesso (cosmético) — quem decide é o servidor.
// Itens com `module` só aparecem se o módulo estiver contratado (§35).
// Visual: identidade do mockup (docs/mockup-l-gestao.html) — ícones + seções.
function buildSections(
  permissions: readonly string[],
  modules: readonly string[],
): Section[] {
  const sections: Section[] = [
    {
      title: "Geral",
      items: [
        { label: "Painel", icon: "🏠", href: "/painel" },
        {
          label: "Dashboard",
          icon: "📊",
          module: "INDICADORES",
          href: permissions.includes("reports.view") ? "/dashboard" : null,
          phase: "sem acesso",
        },
      ],
    },
    {
      title: "Operação",
      items: [
        { label: "Estoque", icon: "📦", module: "ESTOQUE", href: "/estoque" },
        {
          label: "Unidades",
          icon: "🏢",
          module: "MATRIZ_POSTOS",
          href: permissions.includes("units.view") ? "/unidades" : null,
          phase: "sem acesso",
        },
        {
          label: "Lotes",
          icon: "⏳",
          module: "LOTES_VALIDADE",
          href: permissions.includes("stock.view") ? "/lotes" : null,
          phase: "sem acesso",
        },
        {
          label: "Transferências",
          icon: "🔁",
          module: "TRANSFERENCIAS",
          href: permissions.includes("stock.transfer")
            ? "/transferencias"
            : null,
          phase: "sem acesso",
        },
      ],
    },
    {
      title: "Comercial",
      items: [
        {
          label: "Vendas",
          icon: "🧾",
          module: "VENDAS",
          href: permissions.includes("sales.view") ? "/vendas" : null,
          phase: "sem acesso",
        },
        {
          label: "PDV",
          icon: "💳",
          module: "PDV",
          href: permissions.includes("sales.manage") ? "/pdv" : null,
          phase: "sem acesso",
        },
        {
          label: "Compras",
          icon: "🛒",
          module: "COMPRAS",
          href: permissions.includes("purchases.view") ? "/compras" : null,
          phase: "sem acesso",
        },
        {
          label: "Financeiro",
          icon: "💰",
          module: "FINANCEIRO",
          href: permissions.includes("finance.view") ? "/financeiro" : null,
          phase: "sem acesso",
        },
      ],
    },
    {
      title: "Análise",
      items: [
        {
          label: "Relatórios",
          icon: "📈",
          module: "RELATORIOS",
          href: permissions.includes("reports.view") ? "/relatorios" : null,
          phase: "sem acesso",
        },
      ],
    },
    {
      title: "Administração",
      items: [
        { label: "Administração", icon: "🧩", href: "/admin" },
        { label: "Empresas", icon: "🏦", href: "/empresas" },
      ],
    },
  ];
  return sections.map((s) => ({
    ...s,
    items: s.items.filter((item) => !item.module || modules.includes(item.module)),
  }));
}

export function AppSidebar({
  permissions,
  modules,
}: {
  permissions: readonly string[];
  modules: readonly string[];
}) {
  const pathname = usePathname();
  const sections = buildSections(permissions, modules);

  return (
    <aside className="sidebar-rail hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/30">
          L
        </span>
        <span className="brand-title text-sm font-semibold text-slate-900">
          L Gestão
        </span>
      </div>
      <nav className="space-y-4 p-3">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="mb-1.5 px-2 text-[9.5px] font-extrabold uppercase tracking-[0.19em] text-slate-400">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) =>
                item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition ${
                      pathname.startsWith(item.href)
                        ? "nav-active border-indigo-500/35 bg-indigo-500/20 text-indigo-700"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-5 text-center text-[14px] leading-none">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[13px] text-slate-400"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 text-center text-[14px] leading-none opacity-60">
                        {item.icon}
                      </span>
                      {item.label}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      {item.phase}
                    </span>
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
