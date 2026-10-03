import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/server/db/client";
import { members, users, warehouses } from "@/server/db/schema";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  accessibleWarehouseIds,
  assertWarehouseAccessible,
  createUnit,
  deleteUnit,
  deleteUnitTarget,
  getUnitDetail,
  listUnits,
  setUnitMembers,
  UnitError,
  updateUnit,
  upsertUnitTarget,
} from "@/server/modules/unidades/warehouse.service";
import { createTestProduct, createTestTenant } from "./helpers";

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    // pool já encerrado
  }
});

function ctx(tenantId: string, userId: string) {
  return { tenantId, userId };
}

async function criarUsuario(
  tenantId: string,
  role: string,
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      name: `User ${role}`,
      email: `user-${randomUUID().slice(0, 8)}@teste.com`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  await db.insert(members).values({
    organizationId: tenantId,
    userId: u.id,
    role,
  });
  return u.id;
}

describe("unidades — CRUD e hierarquia", () => {
  it("cria MATRIZ → FILIAL → POSTO e lista com nomes de pai/responsável", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const gestorId = await criarUsuario(tenantId, "GERENTE");

    const matriz = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "MATRIZ-01",
        name: "Matriz Campinas",
        type: "MATRIZ",
        parentId: null,
        managerUserId: gestorId,
      }),
    );
    const filial = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "FILIAL-SP",
        name: "Filial São Paulo",
        type: "FILIAL",
        parentId: matriz.id,
        managerUserId: null,
      }),
    );
    const posto = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "POSTO-CPS",
        name: "Posto Campinas",
        type: "POSTO",
        parentId: filial.id,
        managerUserId: null,
      }),
    );

    const lista = await withTenant(tenantId, (tx) => listUnits(tx, tenantId));
    // provision + 3 novas
    expect(lista.length).toBeGreaterThanOrEqual(4);
    const postoRow = lista.find((u) => u.id === posto.id);
    expect(postoRow?.type).toBe("POSTO");
    expect(postoRow?.parentName).toBe("Filial São Paulo");
    const matrizRow = lista.find((u) => u.id === matriz.id);
    expect(matrizRow?.managerName).toBe("User GERENTE");
    // o depósito do provision continua existindo
    expect(lista.some((u) => u.id === warehouseId)).toBe(true);
  });

  it("rejeita MATRIZ com pai, POSTO como pai, ciclo e código duplicado", async () => {
    const { tenantId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");

    const raiz = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "R1",
        name: "Raiz",
        type: "FILIAL",
        parentId: null,
        managerUserId: null,
      }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        createUnit(tx, {
          ...ctx(tenantId, adminId),
          code: "M1",
          name: "Matriz com pai",
          type: "MATRIZ",
          parentId: raiz.id,
          managerUserId: null,
        }),
      ),
    ).rejects.toThrow(UnitError);

    const posto = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "P1",
        name: "Posto folha",
        type: "POSTO",
        parentId: raiz.id,
        managerUserId: null,
      }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        createUnit(tx, {
          ...ctx(tenantId, adminId),
          code: "F2",
          name: "Filha de posto",
          type: "FILIAL",
          parentId: posto.id,
          managerUserId: null,
        }),
      ),
    ).rejects.toThrow(UnitError);

    // ciclo: mover raiz para ser filha de uma descendente
    const filha = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "F3",
        name: "Filha",
        type: "FILIAL",
        parentId: raiz.id,
        managerUserId: null,
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        updateUnit(tx, {
          ...ctx(tenantId, adminId),
          unitId: raiz.id,
          code: "R1",
          name: "Raiz",
          type: "FILIAL",
          parentId: filha.id,
          managerUserId: null,
        }),
      ),
    ).rejects.toThrow(UnitError);

    await expect(
      withTenant(tenantId, (tx) =>
        createUnit(tx, {
          ...ctx(tenantId, adminId),
          code: "R1",
          name: "Duplicada",
          type: "FILIAL",
          parentId: null,
          managerUserId: null,
        }),
      ),
    ).rejects.toThrow(UnitError);
  });

  it("não remove a unidade padrão nem unidade com filhas", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");

    await expect(
      withTenant(tenantId, (tx) =>
        deleteUnit(tx, { tenantId, userId: adminId, unitId: warehouseId }),
      ),
    ).rejects.toThrow(UnitError);

    const pai = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "PAI",
        name: "Pai",
        type: "FILIAL",
        parentId: null,
        managerUserId: null,
      }),
    );
    await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "FILHO",
        name: "Filho",
        type: "POSTO",
        parentId: pai.id,
        managerUserId: null,
      }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        deleteUnit(tx, { tenantId, userId: adminId, unitId: pai.id }),
      ),
    ).rejects.toThrow(UnitError);

    // sem filhos, remove (soft delete)
    const sozinho = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "SOZ",
        name: "Sozinha",
        type: "POSTO",
        parentId: null,
        managerUserId: null,
      }),
    );
    await withTenant(tenantId, (tx) =>
      deleteUnit(tx, { tenantId, userId: adminId, unitId: sozinho.id }),
    );
    const lista = await withTenant(tenantId, (tx) => listUnits(tx, tenantId));
    expect(lista.some((u) => u.id === sozinho.id)).toBe(false);
  });
});

describe("unidades — acesso por usuário (posto não vê outro posto)", () => {
  it("sem vínculos = acesso amplo; ADMIN sempre amplo; com vínculos herda filhas", async () => {
    const { tenantId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const vendedorPostoA = await criarUsuario(tenantId, "VENDEDOR");
    const vendedorSemVinculo = await criarUsuario(tenantId, "VENDEDOR");

    const filial = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "F-SP",
        name: "Filial SP",
        type: "FILIAL",
        parentId: null,
        managerUserId: null,
      }),
    );
    const postoA = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "P-A",
        name: "Posto A",
        type: "POSTO",
        parentId: filial.id,
        managerUserId: null,
      }),
    );
    const postoB = await withTenant(tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(tenantId, adminId),
        code: "P-B",
        name: "Posto B",
        type: "POSTO",
        parentId: filial.id,
        managerUserId: null,
      }),
    );

    // sem vínculos → null (sem restrição)
    const semVinculo = await withTenant(tenantId, (tx) =>
      accessibleWarehouseIds(tx, tenantId, vendedorSemVinculo, "VENDEDOR"),
    );
    expect(semVinculo).toBeNull();

    // ADMIN → null mesmo com vínculos
    const adminAcesso = await withTenant(tenantId, (tx) =>
      accessibleWarehouseIds(tx, tenantId, adminId, "ADMIN"),
    );
    expect(adminAcesso).toBeNull();

    // vendedor do Posto A vê só o Posto A (e filhas dele — não tem)
    await withTenant(tenantId, (tx) =>
      setUnitMembers(tx, {
        tenantId,
        userId: adminId,
        unitId: postoA.id,
        userIds: [vendedorPostoA],
      }),
    );
    const acessoA = await withTenant(tenantId, (tx) =>
      accessibleWarehouseIds(tx, tenantId, vendedorPostoA, "VENDEDOR"),
    );
    expect(acessoA?.sort()).toEqual([postoA.id].sort());

    // não vê o irmão
    await expect(
      withTenant(tenantId, (tx) =>
        assertWarehouseAccessible(
          tx,
          tenantId,
          vendedorPostoA,
          "VENDEDOR",
          postoB.id,
        ),
      ),
    ).rejects.toThrow(UnitError);

    // herança: vendedor da Filial SP vê os dois postos
    const gestorFilial = await criarUsuario(tenantId, "GERENTE");
    await withTenant(tenantId, (tx) =>
      setUnitMembers(tx, {
        tenantId,
        userId: adminId,
        unitId: filial.id,
        userIds: [gestorFilial],
      }),
    );
    const acessoFilial = await withTenant(tenantId, (tx) =>
      accessibleWarehouseIds(tx, tenantId, gestorFilial, "GERENTE"),
    );
    expect(acessoFilial?.sort()).toEqual(
      [filial.id, postoA.id, postoB.id].sort(),
    );
  });

  it("RLS: empresa B não enxerga unidades, membros nem alvos da empresa A", async () => {
    const A = await createTestTenant();
    const B = await createTestTenant();
    const adminA = await criarUsuario(A.tenantId, "ADMIN");

    const unidadeA = await withTenant(A.tenantId, (tx) =>
      createUnit(tx, {
        ...ctx(A.tenantId, adminA),
        code: "SO-DE-A",
        name: "Só da A",
        type: "FILIAL",
        parentId: null,
        managerUserId: null,
      }),
    );

    // leitura cruzada direta no banco (RLS devolve 0 linhas)
    const rowsB = await withTenant(B.tenantId, (tx) =>
      tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, A.tenantId), eq(warehouses.id, unidadeA.id))),
    );
    expect(rowsB).toHaveLength(0);

    // e não aparece na listagem de B
    const listaB = await withTenant(B.tenantId, (tx) => listUnits(tx, B.tenantId));
    expect(listaB.some((u) => u.id === unidadeA.id)).toBe(false);

    // detalhe da unidade de A, lido sob B, não retorna nada
    const detB = await withTenant(B.tenantId, (tx) =>
      getUnitDetail(tx, B.tenantId, unidadeA.id),
    );
    expect(detB).toBeNull();
  });
});

describe("unidades — estoque-alvo", () => {
  it("grava, atualiza e remove alvo; rejeita faixa inválida", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      upsertUnitTarget(tx, {
        tenantId,
        userId: adminId,
        unitId: warehouseId,
        productId,
        minQty: 5,
        maxQty: 20,
        reorderPoint: 10,
      }),
    );
    let det = await withTenant(tenantId, (tx) =>
      getUnitDetail(tx, tenantId, warehouseId),
    );
    expect(det?.targets).toHaveLength(1);
    expect(det?.targets[0]?.minQty).toBe(5);
    expect(det?.targets[0]?.reorderPoint).toBe(10);

    // upsert atualiza
    await withTenant(tenantId, (tx) =>
      upsertUnitTarget(tx, {
        tenantId,
        userId: adminId,
        unitId: warehouseId,
        productId,
        minQty: 8,
        maxQty: 30,
        reorderPoint: 12,
      }),
    );
    det = await withTenant(tenantId, (tx) =>
      getUnitDetail(tx, tenantId, warehouseId),
    );
    expect(det?.targets).toHaveLength(1);
    expect(det?.targets[0]?.minQty).toBe(8);

    // faixa inválida
    await expect(
      withTenant(tenantId, (tx) =>
        upsertUnitTarget(tx, {
          tenantId,
          userId: adminId,
          unitId: warehouseId,
          productId,
          minQty: 50,
          maxQty: 10,
          reorderPoint: null,
        }),
      ),
    ).rejects.toThrow(UnitError);

    await withTenant(tenantId, (tx) =>
      deleteUnitTarget(tx, {
        tenantId,
        userId: adminId,
        unitId: warehouseId,
        productId,
      }),
    );
    det = await withTenant(tenantId, (tx) =>
      getUnitDetail(tx, tenantId, warehouseId),
    );
    expect(det?.targets).toHaveLength(0);
  });
});

describe("unidades — RBAC", () => {
  it("VENDEDOR não gerencia unidades; ADMIN e GERENTE gerenciam; VISUALIZADOR só vê", () => {
    expect(() => assertPermission("VENDEDOR", "units.manage")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("VENDEDOR", "units.view")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("VISUALIZADOR", "units.view")).not.toThrow();
    expect(() => assertPermission("VISUALIZADOR", "units.manage")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("ESTOQUISTA", "units.manage")).not.toThrow();
    expect(() => assertPermission("GERENTE", "units.manage")).not.toThrow();
    expect(() => assertPermission("FINANCEIRO", "units.view")).not.toThrow();
    expect(() => assertPermission("FINANCEIRO", "units.manage")).toThrow(
      PermissionError,
    );
  });

  it("permissões units.* existem no catálogo provisionado do tenant", async () => {
    const { tenantId } = await createTestTenant();
    const { permissions, rolePermissions, roles } = await import(
      "@/server/db/schema"
    );
    const catalog = await db
      .select()
      .from(permissions)
      .where(eq(permissions.module, "units"));
    expect(catalog.map((p) => p.key).sort()).toEqual([
      "units.manage",
      "units.view",
    ]);

    // matriz provisionada para os papéis do tenant novo (roles tem RLS)
    const pares = await withTenant(tenantId, (tx) =>
      tx
        .select({ key: permissions.key, role: roles.key })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .innerJoin(
          permissions,
          eq(permissions.key, rolePermissions.permissionKey),
        )
        .where(eq(roles.tenantId, tenantId)),
    );
    const doVendedor = pares.filter((p) => p.role === "VENDEDOR");
    expect(doVendedor.some((p) => p.key.startsWith("units."))).toBe(false);
    const doAdmin = pares.filter((p) => p.role === "ADMIN");
    expect(doAdmin.some((p) => p.key === "units.manage")).toBe(true);
  });
});
