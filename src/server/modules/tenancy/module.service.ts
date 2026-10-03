import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { modules, subscriptions, tenantModules } from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  MODULE_CATALOG,
  moduleErrorMessage,
  resolveModuleKeys,
  type SegmentValue,
} from "./module-rules";

// Módulos contratáveis por empresa (PROMPT MESTRE §35). O menu só é cosmético:
// `requireModule` decide no servidor — sempre junto de requirePermission.

export class ModuleError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ModuleError";
  }
}

export async function listTenantModuleKeys(
  tx: TenantTx,
  tenantId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ key: modules.key })
    .from(tenantModules)
    .innerJoin(modules, eq(modules.id, tenantModules.moduleId))
    .where(
      and(
        eq(tenantModules.tenantId, tenantId),
        eq(tenantModules.active, true),
      ),
    );
  return rows.map((r) => r.key);
}

export async function hasModule(
  tx: TenantTx,
  tenantId: string,
  key: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tenantModules.id })
    .from(tenantModules)
    .innerJoin(modules, eq(modules.id, tenantModules.moduleId))
    .where(
      and(
        eq(tenantModules.tenantId, tenantId),
        eq(modules.key, key),
        eq(tenantModules.active, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function requireModule(
  tx: TenantTx,
  tenantId: string,
  key: string,
): Promise<void> {
  if (!(await hasModule(tx, tenantId, key))) {
    throw new ModuleError(moduleErrorMessage(key));
  }
}

/**
 * Provisiona os módulos do tenant (idempotente): catálogo global + preset do
 * segmento + assinatura TRIAL. Reprovisionar apenas ACRESCENTA módulos.
 */
export async function provisionModules(
  tx: TenantTx,
  tenantId: string,
  segment: SegmentValue,
): Promise<void> {
  await tx
    .insert(modules)
    .values(MODULE_CATALOG.map((m) => ({ ...m })))
    .onConflictDoNothing();

  const catalogRows = await tx.select().from(modules);
  const byKey = new Map(catalogRows.map((m) => [m.key, m.id]));

  const keys = resolveModuleKeys({ segment });
  const rows = keys
    .map((k) => byKey.get(k))
    .filter((id): id is string => Boolean(id))
    .map((moduleId) => ({ tenantId, moduleId }));
  if (rows.length > 0) {
    await tx.insert(tenantModules).values(rows).onConflictDoNothing();
  }

  await tx
    .insert(subscriptions)
    .values({ tenantId, status: "TRIAL" })
    .onConflictDoNothing();
}

/** Ativa/desativa um módulo da empresa e audita a alteração. */
export async function setTenantModule(
  tx: TenantTx,
  ctx: { tenantId: string; userId?: string | null },
  key: string,
  active: boolean,
): Promise<void> {
  const [mod] = await tx
    .select()
    .from(modules)
    .where(eq(modules.key, key))
    .limit(1);
  if (!mod) throw new ModuleError(`Módulo ${key} não existe.`);

  await tx
    .insert(tenantModules)
    .values({
      tenantId: ctx.tenantId,
      moduleId: mod.id,
      active,
      contractedBy: ctx.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleId],
      set: {
        active,
        updatedAt: new Date(),
        contractedBy: ctx.userId ?? null,
      },
    });

  await audit(tx, {
    action: active ? "MODULO_ATIVADO" : "MODULO_DESATIVADO",
    module: "modulos",
    entityType: "module",
    entityId: mod.id,
    after: { key, active },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });
}
