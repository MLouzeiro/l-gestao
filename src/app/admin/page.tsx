import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members, users } from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { resolvePermissions } from "@/server/rbac/permissions";
import { EquipePanel } from "@/components/admin/equipe-panel";

export default async function AdminPage() {
  const { session, tenantId, role } = await requirePermission("users.view");
  const canManage = resolvePermissions(role).includes("users.manage");

  const rows = await db
    .select({
      memberId: members.id,
      userId: members.userId,
      role: members.role,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, tenantId))
    .orderBy(members.createdAt);

  const invitations = await auth.api.listInvitations({
    headers: await headers(),
    query: { organizationId: tenantId },
  });

  const invites = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt
      ? new Date(inv.expiresAt).toISOString()
      : null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Administra��ǜo �?" Equipe
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Membros, papǸis e convites desta empresa.
          {!canManage && " (leitura apenas)"}
        </p>
        <p className="mt-2">
          <a
            href="/admin/modulos"
            className="text-sm font-semibold text-indigo-600 hover:underline"
          >
            Gerenciar módulos contratados →
          </a>
        </p>
      </div>
      <EquipePanel
        members={rows}
        invitations={invites}
        canManage={canManage}
        currentUserId={session.user.id}
      />
    </div>
  );
}
