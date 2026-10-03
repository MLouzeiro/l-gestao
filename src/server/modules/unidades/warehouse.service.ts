import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  members,
  products,
  users,
  warehouses,
  warehouseMembers,
  warehouseProductTargets,
} from "@/server/db/schema";
import { audit } from "@/server/audit/log";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  assertUnitHierarchy,
  expandMemberAccess,
  selectDefaultWarehouse,
  validateUnitTarget,
  UnitError,
  type UnitNode,
  type UnitType,
} from "./warehouse-rules";

export { UnitError };
export type { UnitType };

export type UnitListItem = {
  id: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
  parentName: string | null;
  managerUserId: string | null;
  managerName: string | null;
  isDefault: boolean;
};

export type UnitFormData = {
  units: { id: string; code: string; name: string; type: UnitType }[];
  managers: { userId: string; name: string; email: string }[];
};

export type UnitMemberView = {
  userId: string;
  name: string;
  email: string;
  role: string;
  linked: boolean;
};

export type UnitTargetView = {
  productId: string;
  sku: string;
  name: string;
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
};

const num = (v: string | null): number | null =>
  v === null ? null : Number(v);

async function loadNodes(tx: TenantTx, tenantId: string): Promise<UnitNode[]> {
  const rows = await tx
    .select({
      id: warehouses.id,
      parentId: warehouses.parentId,
      type: warehouses.type,
    })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    type: r.type,
  }));
}

async function assertCodeFree(
  tx: TenantTx,
  tenantId: string,
  code: string,
  selfId?: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.code, code),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (row && row.id !== selfId) {
    throw new UnitError("Já existe uma unidade com este código.");
  }
}

async function assertParentInTenant(
  tx: TenantTx,
  tenantId: string,
  parentId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, parentId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new UnitError("Unidade pai não encontrada.");
}

export async function listUnits(
  tx: TenantTx,
  tenantId: string,
): Promise<UnitListItem[]> {
  const rows = await tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      type: warehouses.type,
      parentId: warehouses.parentId,
      managerUserId: warehouses.managerUserId,
      isDefault: warehouses.isDefault,
    })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
    .orderBy(warehouses.code);

  const names = new Map(rows.map((r) => [r.id, r.name]));
  const managers = await tx
    .select({
      userId: users.id,
      name: users.name,
    })
    .from(users)
    .innerJoin(
      members,
      and(
        eq(members.userId, users.id),
        eq(members.organizationId, tenantId),
      ),
    );
  const managerNames = new Map(managers.map((m) => [m.userId, m.name]));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    parentId: r.parentId,
    parentName: r.parentId
      ? (names.get(r.parentId) ?? null)
      : null,
    managerUserId: r.managerUserId,
    managerName: r.managerUserId
      ? (managerNames.get(r.managerUserId) ?? null)
      : null,
    isDefault: r.isDefault,
  }));
}

export async function loadUnitFormData(
  tx: TenantTx,
  tenantId: string,
): Promise<UnitFormData> {
  const units = await tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      type: warehouses.type,
    })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
    .orderBy(warehouses.code);

  const managers = await tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(
      members,
      and(
        eq(members.userId, users.id),
        eq(members.organizationId, tenantId),
      ),
    )
    .orderBy(users.name);

  return { units, managers };
}

export type CreateUnitInput = {
  tenantId: string;
  userId: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
  managerUserId: string | null;
};

export async function createUnit(
  tx: TenantTx,
  input: CreateUnitInput,
): Promise<{ id: string }> {
  const { tenantId, userId, code, name, type, parentId, managerUserId } = input;
  await assertCodeFree(tx, tenantId, code);
  if (parentId) await assertParentInTenant(tx, tenantId, parentId);
  const nodes = await loadNodes(tx, tenantId);
  assertUnitHierarchy({ parentId, type, nodes });

  const [row] = await tx
    .insert(warehouses)
    .values({
      tenantId,
      code,
      name,
      type,
      parentId,
      managerUserId,
    })
    .returning({ id: warehouses.id });

  await audit(tx, {
    action: "UNIDADE_CRIADA",
    module: "unidades",
    entityType: "warehouse",
    entityId: row.id,
    after: { code, name, type, parentId, managerUserId },
    userId,
  });
  return { id: row.id };
}

export type UpdateUnitInput = {
  tenantId: string;
  userId: string;
  unitId: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
  managerUserId: string | null;
};

export async function updateUnit(
  tx: TenantTx,
  input: UpdateUnitInput,
): Promise<{ id: string }> {
  const { tenantId, userId, unitId, code, name, type, parentId, managerUserId } =
    input;
  const [existing] = await tx
    .select()
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, unitId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new UnitError("Unidade não encontrada.");

  await assertCodeFree(tx, tenantId, code, unitId);
  if (parentId) {
    if (parentId === unitId) {
      throw new UnitError("Uma unidade não pode ser pai de si mesma.");
    }
    await assertParentInTenant(tx, tenantId, parentId);
  }
  const nodes = await loadNodes(tx, tenantId);
  assertUnitHierarchy({ selfId: unitId, parentId, type, nodes });

  await tx
    .update(warehouses)
    .set({
      code,
      name,
      type,
      parentId,
      managerUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, unitId)));

  await audit(tx, {
    action: "UNIDADE_ALTERADA",
    module: "unidades",
    entityType: "warehouse",
    entityId: unitId,
    before: {
      code: existing.code,
      name: existing.name,
      type: existing.type,
      parentId: existing.parentId,
      managerUserId: existing.managerUserId,
    },
    after: { code, name, type, parentId, managerUserId },
    userId,
  });
  return { id: unitId };
}

export async function deleteUnit(
  tx: TenantTx,
  input: { tenantId: string; userId: string; unitId: string },
): Promise<void> {
  const { tenantId, userId, unitId } = input;
  const [existing] = await tx
    .select()
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, unitId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new UnitError("Unidade não encontrada.");
  if (existing.isDefault) {
    throw new UnitError("A unidade padrão não pode ser removida.");
  }

  const nodes = await loadNodes(tx, tenantId);
  const filhos = nodes.filter((n) => n.parentId === unitId);
  if (filhos.length > 0) {
    throw new UnitError(
      "A unidade possui unidades filhas — remova ou reaponte-as antes.",
    );
  }

  await tx
    .update(warehouses)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, unitId)));

  await audit(tx, {
    action: "UNIDADE_REMOVIDA",
    module: "unidades",
    entityType: "warehouse",
    entityId: unitId,
    before: { code: existing.code, name: existing.name, type: existing.type },
    userId,
  });
}

export async function listUnitMembers(
  tx: TenantTx,
  tenantId: string,
  unitId: string,
): Promise<UnitMemberView[]> {
  const all = await tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: members.role,
    })
    .from(users)
    .innerJoin(
      members,
      and(
        eq(members.userId, users.id),
        eq(members.organizationId, tenantId),
      ),
    )
    .orderBy(users.name);

  const linked = await tx
    .select({ userId: warehouseMembers.userId })
    .from(warehouseMembers)
    .where(
      and(
        eq(warehouseMembers.tenantId, tenantId),
        eq(warehouseMembers.warehouseId, unitId),
      ),
    );
  const linkedSet = new Set(linked.map((l) => l.userId));

  return all.map((u) => ({ ...u, linked: linkedSet.has(u.userId) }));
}

export async function setUnitMembers(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    unitId: string;
    userIds: string[];
  },
): Promise<void> {
  const { tenantId, userId, unitId, userIds } = input;
  const [unit] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, unitId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!unit) throw new UnitError("Unidade não encontrada.");

  await tx
    .delete(warehouseMembers)
    .where(
      and(
        eq(warehouseMembers.tenantId, tenantId),
        eq(warehouseMembers.warehouseId, unitId),
      ),
    );
  if (userIds.length > 0) {
    await tx.insert(warehouseMembers).values(
      userIds.map((uid) => ({
        tenantId,
        warehouseId: unitId,
        userId: uid,
      })),
    );
  }

  await audit(tx, {
    action: "UNIDADE_ACESSO_ALTERADO",
    module: "unidades",
    entityType: "warehouse_member",
    entityId: unitId,
    after: { userIds },
    userId,
  });
}

export async function listUnitTargets(
  tx: TenantTx,
  tenantId: string,
  unitId: string,
): Promise<UnitTargetView[]> {
  const rows = await tx
    .select({
      productId: warehouseProductTargets.productId,
      sku: products.sku,
      name: products.name,
      minQty: warehouseProductTargets.minQty,
      maxQty: warehouseProductTargets.maxQty,
      reorderPoint: warehouseProductTargets.reorderPoint,
    })
    .from(warehouseProductTargets)
    .innerJoin(
      products,
      and(
        eq(products.id, warehouseProductTargets.productId),
        eq(products.tenantId, warehouseProductTargets.tenantId),
      ),
    )
    .where(
      and(
        eq(warehouseProductTargets.tenantId, tenantId),
        eq(warehouseProductTargets.warehouseId, unitId),
      ),
    )
    .orderBy(products.name);

  return rows.map((r) => ({
    productId: r.productId,
    sku: r.sku,
    name: r.name,
    minQty: num(r.minQty),
    maxQty: num(r.maxQty),
    reorderPoint: num(r.reorderPoint),
  }));
}

export async function upsertUnitTarget(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    unitId: string;
    productId: string;
    minQty: number | null;
    maxQty: number | null;
    reorderPoint: number | null;
  },
): Promise<void> {
  const { tenantId, userId, unitId, productId, minQty, maxQty, reorderPoint } =
    input;
  validateUnitTarget({ minQty, maxQty, reorderPoint });

  const [unit] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, unitId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!unit) throw new UnitError("Unidade não encontrada.");

  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.id, productId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!product) throw new UnitError("Produto não encontrado.");

  await tx
    .insert(warehouseProductTargets)
    .values({
      tenantId,
      warehouseId: unitId,
      productId,
      minQty: minQty === null ? null : String(minQty),
      maxQty: maxQty === null ? null : String(maxQty),
      reorderPoint: reorderPoint === null ? null : String(reorderPoint),
    })
    .onConflictDoUpdate({
      target: [
        warehouseProductTargets.tenantId,
        warehouseProductTargets.warehouseId,
        warehouseProductTargets.productId,
      ],
      set: {
        minQty: minQty === null ? null : String(minQty),
        maxQty: maxQty === null ? null : String(maxQty),
        reorderPoint: reorderPoint === null ? null : String(reorderPoint),
        updatedAt: new Date(),
      },
    });

  await audit(tx, {
    action: "UNIDADE_ESTOQUE_ALVO",
    module: "unidades",
    entityType: "warehouse_product_target",
    entityId: unitId,
    after: { productId, minQty, maxQty, reorderPoint },
    userId,
  });
}

export async function deleteUnitTarget(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    unitId: string;
    productId: string;
  },
): Promise<void> {
  const { tenantId, userId, unitId, productId } = input;
  await tx
    .delete(warehouseProductTargets)
    .where(
      and(
        eq(warehouseProductTargets.tenantId, tenantId),
        eq(warehouseProductTargets.warehouseId, unitId),
        eq(warehouseProductTargets.productId, productId),
      ),
    );
  await audit(tx, {
    action: "UNIDADE_ESTOQUE_ALVO_REMOVIDO",
    module: "unidades",
    entityType: "warehouse_product_target",
    entityId: unitId,
    before: { productId },
    userId,
  });
}

/**
 * Unidades acessíveis ao usuário:
 * - ADMIN ou usuário sem vínculos em warehouse_members → `null` (sem restrição);
 * - com vínculos → lista com as próprias unidades + descendentes (herança).
 */
export async function accessibleWarehouseIds(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  role: string,
): Promise<string[] | null> {
  if (role === "ADMIN") return null;

  const links = await tx
    .select({ warehouseId: warehouseMembers.warehouseId })
    .from(warehouseMembers)
    .where(
      and(
        eq(warehouseMembers.tenantId, tenantId),
        eq(warehouseMembers.userId, userId),
      ),
    );
  if (links.length === 0) return null;

  const nodes = await loadNodes(tx, tenantId);
  return expandMemberAccess(
    nodes,
    links.map((l) => l.warehouseId),
  );
}

/** Lança UnitError se o usuário não tem acesso à unidade. */
export async function assertWarehouseAccessible(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  role: string,
  warehouseId: string,
): Promise<void> {
  const allowed = await accessibleWarehouseIds(tx, tenantId, userId, role);
  if (allowed === null) return;
  if (!allowed.includes(warehouseId)) {
    throw new UnitError("Você não tem acesso a esta unidade.");
  }
}

/** Unidade operacional padrão (ex.: depósito do PDV) entre as acessíveis. */
export async function defaultWarehouseId(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  role: string,
): Promise<string | null> {
  const allowed = await accessibleWarehouseIds(tx, tenantId, userId, role);
  const rows = await tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      isDefault: warehouses.isDefault,
    })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));
  const filtered =
    allowed === null ? rows : rows.filter((r) => allowed.includes(r.id));
  return selectDefaultWarehouse(filtered);
}

export type UnitDetail = {
  id: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
  managerUserId: string | null;
  isDefault: boolean;
  members: UnitMemberView[];
  targets: UnitTargetView[];
};

export async function getUnitDetail(
  tx: TenantTx,
  tenantId: string,
  unitId: string,
): Promise<UnitDetail | null> {
  const [unit] = await tx
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      type: warehouses.type,
      parentId: warehouses.parentId,
      managerUserId: warehouses.managerUserId,
      isDefault: warehouses.isDefault,
    })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, unitId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!unit) return null;

  const [unitMembers, targets] = await Promise.all([
    listUnitMembers(tx, tenantId, unitId),
    listUnitTargets(tx, tenantId, unitId),
  ]);

  return { ...unit, members: unitMembers, targets };
}

/** Ids de unidades (para filtros em queries) — usado pelas listagens. */
export async function accessibleWarehouseFilter(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  role: string,
): Promise<{ all: true } | { all: false; ids: string[] }> {
  const ids = await accessibleWarehouseIds(tx, tenantId, userId, role);
  return ids === null ? { all: true } : { all: false, ids };
}

/** Membros do tenant (para o select de responsável). */
export async function listTenantUsers(
  tx: TenantTx,
  tenantId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
  return tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(
      members,
      and(
        eq(members.userId, users.id),
        eq(members.organizationId, tenantId),
      ),
    )
    .orderBy(users.name);
}

/** Usuários por ids (validação de membros vindos do form). */
export async function assertUsersInTenant(
  tx: TenantTx,
  tenantId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(
        eq(members.organizationId, tenantId),
        inArray(members.userId, userIds),
      ),
    );
  if (rows.length !== new Set(userIds).size) {
    throw new UnitError("Usuário inválido para esta empresa.");
  }
}
