import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members } from "@/server/db/schema";
import { assertPermission } from "@/server/rbac/permissions";

// Ponto de entrada obrigatório de toda Server Action sensível:
// sessão → empresa ativa → membership → permissão da matriz.
// A guarda em si (PermissionError/status 403) vive em rbac/permissions.ts —
// módulo puro, testável sem sessão.

export async function requirePermission(permission: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const tenantId = session.session.activeOrganizationId;
  if (!tenantId) redirect("/empresas");

  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.organizationId, tenantId),
        eq(members.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) redirect("/empresas");

  assertPermission(member.role, permission);

  return { session, tenantId, role: member.role };
}
