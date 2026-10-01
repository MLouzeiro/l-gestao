import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  permissionCatalog,
  permissions,
  rolePermissions,
  roles,
  systemRoles,
  tenantSettings,
  warehouses,
} from "@/server/db/schema";
import { ROLE_PERMISSIONS } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";

export const ROLE_NAMES: Record<string, string> = {
  ADMIN: "Administrador",
  GERENTE: "Gerente",
  FINANCEIRO: "Financeiro",
  ESTOQUISTA: "Estoquista",
  VENDEDOR: "Vendedor",
  VISUALIZADOR: "Visualizador",
};

// Popula tudo que um tenant novo precisa (regra da Fase 1 — M1):
// tenant_settings padrão, papéis-sistema e suas permissões.
// Idempotente: pode rodar de novo sem duplicar.
export async function provisionTenant(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    // Catálogo global de permissões (tabela sem RLS, dados estáticos)
    if (permissionCatalog.length > 0) {
      await tx
        .insert(permissions)
        .values(permissionCatalog.map((p) => ({ ...p })))
        .onConflictDoNothing();
    }

    // Configurações padrão da empresa (colunas já trazem defaults do banco;
    // o insert garante a linha existente com os valores padrão)
    await tx
      .insert(tenantSettings)
      .values({ tenantId })
      .onConflictDoNothing();

    // Depósito padrão (Fase 6): toda empresa precisa de um depósito para
    // movimentar estoque. Idempotente (conflict = já existe).
    await tx
      .insert(warehouses)
      .values({
        tenantId,
        code: "PRINCIPAL",
        name: "Depósito Padrão",
        isDefault: true,
      })
      .onConflictDoNothing();

    // Papéis-sistema deste tenant
    await tx
      .insert(roles)
      .values(
        systemRoles.map((key) => ({
          tenantId,
          key,
          name: ROLE_NAMES[key] ?? key,
          isSystem: true,
        })),
      )
      .onConflictDoNothing();

    // Vínculo papel → permissões
    const tenantRoles = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.tenantId, tenantId));

    const pairs = tenantRoles.flatMap((r) =>
      (ROLE_PERMISSIONS[r.key] ?? []).map((permissionKey) => ({
        roleId: r.id,
        permissionKey,
      })),
    );

    if (pairs.length > 0) {
      await tx.insert(rolePermissions).values(pairs).onConflictDoNothing();
    }
  });
}
