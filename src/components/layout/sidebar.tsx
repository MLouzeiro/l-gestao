"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  label: string;
  href: string | null;
  phase?: string;
};

// A sidebar só esconde o acesso (cosmético) — quem decide é o servidor.
function buildItems(permissions: readonly string[]): Item[] {
  return [
    { label: "Painel", href: "/painel" },
    { label: "Estoque", href: "/estoque" },
    {
      label: "Vendas",
      href: permissions.includes("sales.view") ? "/vendas" : null,
      phase: "sem acesso",
    },
    {
      label: "Compras",
      href: permissions.includes("purchases.view") ? "/compras" : null,
      phase: "sem acesso",
    },
    { label: "Financeiro", href: permissions.includes("finance.view") ? "/financeiro" : null, phase: "sem acesso" },
    { label: "Relatórios", href: null, phase: "Fase 12" },
    { label: "Administração", href: "/admin" },
    { label: "Empresas", href: "/empresas" },
  ];
}

export function AppSidebar({
  permissions,
}: {
  permissions: readonly string[];
}) {
  const pathname = usePathname();
  const items = buildItems(permissions);

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
