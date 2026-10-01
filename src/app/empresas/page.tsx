import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members, tenants } from "@/server/db/schema";
import { ROLE_NAMES } from "@/server/modules/tenancy/provision";
import { selecionarEmpresa, sair } from "@/actions/empresas";
import { CriarEmpresaForm } from "@/components/empresas/criar-empresa-form";

export const metadata = { title: "Empresas" };

export default async function EmpresasPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const activeOrgId = session.session.activeOrganizationId;

  // Tabela members/tenants sem RLS (membership validado na aplicação,
  // conforme docs/ARQUITETURA.md §4)
  const empresas = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      role: members.role,
    })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.organizationId))
    .where(eq(members.userId, session.user.id));

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600 text-sm font-bold text-white">
              E
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Suas empresas
              </h1>
              <p className="text-xs text-slate-500">
                Olá, {session.user.name} — escolha por onde trabalhar
              </p>
            </div>
          </div>
          <form action={sair}>
            <button
              type="submit"
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Sair
            </button>
          </form>
        </div>

        <section className="space-y-3">
          {empresas.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
              Você ainda não pertence a nenhuma empresa. Crie a primeira
              abaixo.
            </p>
          )}
          {empresas.map((e) => {
            const ativa = e.id === activeOrgId;
            return (
              <div
                key={e.id}
                className={`flex items-center justify-between rounded-lg border bg-white p-4 ${
                  ativa ? "border-indigo-300 ring-1 ring-indigo-100" : "border-slate-200"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {e.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {e.slug} ·{" "}
                    <span className="text-slate-500">
                      {ROLE_NAMES[e.role] ?? e.role}
                    </span>{" "}
                    · {e.status === "TRIAL" ? "Teste" : e.status}
                  </p>
                </div>
                {ativa ? (
                  <span className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                    Ativa
                  </span>
                ) : (
                  <form action={selecionarEmpresa}>
                    <input type="hidden" name="organizationId" value={e.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Usar empresa
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Criar nova empresa
          </h2>
          <CriarEmpresaForm />
        </section>
      </div>
    </main>
  );
}
