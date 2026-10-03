import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  modules,
  plans,
  subscriptions,
  tenantModules,
} from "@/server/db/schema";
import { MODULE_CATALOG } from "@/server/modules/tenancy/module-rules";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { ModuloToggle } from "@/components/admin/modulo-toggle";

export default async function AdminModulosPage() {
  const { tenantId } = await requirePermission("settings.manage");

  const data = await withTenant(tenantId, async (tx) => {
    const catalog = await tx.select().from(modules).orderBy(modules.name);
    const contracted = await tx
      .select()
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, tenantId));
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);
    const planRow = sub?.planId
      ? await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1)
      : [];
    return { catalog, contracted, sub: sub ?? null, plan: planRow[0] ?? null };
  });

  const activeByModule = new Map(
    data.contracted.map((c) => [c.moduleId, c.active]),
  );
  const nomeModulo = new Map(MODULE_CATALOG.map((m) => [m.key, m.name]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Administração — Módulos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Módulos contratados desta empresa. O menu e as telas mudam conforme o
          que está ativo.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Assinatura
        </p>
        {data.sub ? (
          <p className="mt-1 text-sm text-slate-700">
            Status: <strong>{data.sub.status}</strong>
            {data.plan ? ` · Plano: ${data.plan.name}` : " · Sem plano formal"}
            {" · desde "}
            {new Date(data.sub.startedAt).toLocaleDateString("pt-BR")}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Sem assinatura registrada.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="p-4">Módulo</th>
              <th className="p-4">Descrição</th>
              <th className="p-4 text-right">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.catalog.map((m) => {
              const active = activeByModule.get(m.id) ?? false;
              return (
                <tr key={m.id}>
                  <td className="p-4 font-semibold text-slate-800">
                    {nomeModulo.get(m.key) ?? m.name}
                    <span className="ml-2 font-mono text-[10px] text-slate-400">
                      {m.key}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-slate-500">
                    {m.description}
                  </td>
                  <td className="p-4 text-right">
                    <ModuloToggle moduleKey={m.key} active={active} />
                  </td>
                </tr>
              );
            })}
            {data.catalog.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-slate-400">
                  Nenhum módulo no catálogo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-500">
        <Link href="/admin" className="font-semibold text-indigo-600 hover:underline">
          ← Voltar para Administração
        </Link>
      </p>
    </div>
  );
}
