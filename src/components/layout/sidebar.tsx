"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  label: string;
  href: string | null;
  module?: string;
  phase?: string;
};

// A sidebar só esconde o acesso (cosmético) — quem decide é o servidor.
// Itens com `module` só aparecem se o módulo estiver contratado (§35).
function buildItems(
  permissions: readonly string[],
  modules: readonly string[],
): Item[] {
  return [
    { label: "Painel", href: "/painel" },
    {
      label: "Dashboard",
      module: "INDICADORES",
      href: permissions.includes("reports.view") ? "/dashboard" : null,
      phase: "sem acesso",
    },
    { label: "Estoque", module: "ESTOQUE", href: "/estoque" },
    {
      label: "Unidades",
      module: "MATRIZ_POSTOS",
      href: permissions.includes("units.view") ? "/unidades" : null,
      phase: "sem acesso",
    },
    {
      label: "Transferências",
      module: "TRANSFERENCIAS",
      href: permissions.includes("stock.transfer") ? "/transferencias" : null,
      phase: "sem acesso",
    },
    {
      label: "Vendas",
      module: "VENDAS",
      href: permissions.includes("sales.view") ? "/vendas" : null,
      phase: "sem acesso",
    },
    {
      label: "PDV",
      module: "PDV",
      href: permissions.includes("sales.manage") ? "/pdv" : null,
      phase: "sem acesso",
    },
    {
      label: "Compras",
      module: "COMPRAS",
      href: permissions.includes("purchases.view") ? "/compras" : null,
      phase: "sem acesso",
    },
    { label: "Financeiro", module: "FINANCEIRO", href: permissions.includes("finance.view") ? "/financeiro" : null, phase: "sem acesso" },
    { label: "Relatórios", module: "RELATORIOS", href: permissions.includes("reports.view") ? "/relatorios" : null, phase: "sem acesso" },
    { label: "Administração", href: "/admin" },
    { label: "Empresas", href: "/empresas" },
  ].filter((item) => !item.module || modules.includes(item.module));
}

export function AppSidebar({
  permissions,
  modules,
}: {
  permissions: readonly string[];
  modules: readonly string[];
}) {
  const pathname = usePathname();
  const items = buildItems(permissions, modules);

  return (
    <aside className="sidebar-rail hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
      <div className="flex h-14 items-center border-b border-slate-200 px-4">
        <span className="brand-mark flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
          L
        </span>
        <span className="brand-title ml-2 text-sm font-semibold text-slate-900">
          L Gestão
        </span>
      </div>
      <nav className="space-y-1 p-3">
        {items.map((item) =>
          item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                pathname.startsWith(item.href)
                  ? "nav-active bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-400"
            >
              {item.label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {item.phase}
              </span>
            </span>
          ),
        )}
      </nav>
    </aside>
  );
}
