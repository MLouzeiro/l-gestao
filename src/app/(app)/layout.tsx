import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members, tenants } from "@/server/db/schema";
import { resolvePermissions } from "@/server/rbac/permissions";
import { listTenantModuleKeys } from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { AppSidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  // Sem empresa ativa → seleção de empresa (Fase 4)
  const tenantId = session.session.activeOrganizationId;
  if (!tenantId) redirect("/empresas");

  const [tenant] = await db
    .select({ name: tenants.name, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) redirect("/empresas");

  // M1: só membro acessa a empresa ativa
  const [member] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(eq(members.organizationId, tenantId), eq(members.userId, session.user.id)),
    )
    .limit(1);
  if (!member) redirect("/empresas");

  // M1: ADMIN precisa ter 2FA configurado (página fora do grupo (app))
  if (member.role === "ADMIN" && !session.user.twoFactorEnabled) {
    redirect("/configurar-2fa");
  }

  // Módulos contratados (PROMPT MESTRE §35) — o menu aparece conforme o
  // contrato da empresa; o servidor continua decidindo o acesso real.
  const moduleKeys = await withTenant(tenantId, (tx) =>
    listTenantModuleKeys(tx, tenantId),
  );

  return (
    <div className="flex min-h-screen bg-slate-100">
      <AppSidebar
        permissions={resolvePermissions(member.role)}
        modules={moduleKeys}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
            />
            <span className="truncate text-sm font-semibold text-slate-700">
              {tenant.name}
            </span>
            <a
              href="/empresas"
              className="shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-indigo-600 hover:border-indigo-400 hover:text-indigo-700"
            >
              Trocar empresa
            </a>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu name={session.user.name} email={session.user.email} />
          </div>
        </header>        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
