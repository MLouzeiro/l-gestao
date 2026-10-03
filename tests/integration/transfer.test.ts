import { and, eq } from "drizzle-orm";
import { db, pool } from "@/server/db/client";
import {
  members,
  stockBalances,
  stockMovements,
  transferItems,
  transfers,
  users,
  warehouses,
} from "@/server/db/schema";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import {
  cancelTransfer,
  createTransfer,
  getTransferDetail,
  receiveTransfer,
  sendTransfer,
  TransferError,
} from "@/server/modules/transferencias/transfer.service";
import { randomUUID } from "node:crypto";
import { createTestProduct, createTestTenant } from "./helpers";

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    // pool já encerrado
  }
});

async function criarUsuario(tenantId: string, role: string): Promise<string> {
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

async function criarUnidade(
  tenantId: string,
  _userId: string,
  code: string,
): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [w] = await tx
      .insert(warehouses)
      .values({ tenantId, code, name: `Unidade ${code}` })
      .returning({ id: warehouses.id });
    return w.id;
  });
}

async function addStock(
  tenantId: string,
  warehouseId: string,
  productId: string,
  quantity: number,
  cost = 1000,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    applyMovement(tx, {
      tenantId,
      type: "ENTRADA_AJUSTE",
      productId,
      warehouseId,
      quantity,
      unitCostCents: cost,
    }),
  );
}

async function saldo(
  tenantId: string,
  warehouseId: string,
  productId: string,
): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ quantity: stockBalances.quantity })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.productId, productId),
        ),
      ),
  );
  return rows.length > 0 ? Number(rows[0]!.quantity) : 0;
}

describe("transferências — fluxo simples (imediato)", () => {
  it("saída 10 + entrada 10 na hora: origem 10→0, destino 0→10, mesmo transfer_id", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10, 500);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    const r = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        immediate: true,
        items: [{ productId, quantity: 10 }],
      }),
    );
    expect(r.status).toBe("RECEIVED");

    expect(await saldo(tenantId, warehouseId, productId)).toBe(0);
    expect(await saldo(tenantId, destino, productId)).toBe(10);

    // dois movimentos com o mesmo transfer_id
    const movs = await withTenant(tenantId, (tx) =>
      tx
        .select({
          type: stockMovements.type,
          transferId: stockMovements.transferId,
          unitCost: stockMovements.unitCost,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.transferId, r.id),
          ),
        ),
    );
    expect(movs).toHaveLength(2);
    expect(movs.map((m) => m.type).sort()).toEqual([
      "TRANSFERENCIA_ENTRADA",
      "TRANSFERENCIA_SAIDA",
    ]);
    // custo preservado (500 centavos em ambos os lados)
    for (const m of movs) {
      expect(Math.round(Number(m.unitCost) * 100)).toBe(500);
    }
  });

  it("saldo insuficiente na origem recusa a transferência inteira (rollback)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 2);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    await expect(
      withTenant(tenantId, (tx) =>
        createTransfer(tx, ctx, {
          fromWarehouseId: warehouseId,
          toWarehouseId: destino,
          settleOn: "SEND",
          immediate: true,
          items: [{ productId, quantity: 5 }],
        }),
      ),
    ).rejects.toThrow("Saldo insuficiente");

    // nada mudou
    expect(await saldo(tenantId, warehouseId, productId)).toBe(2);
    expect(await saldo(tenantId, destino, productId)).toBe(0);
  });
});

describe("transferências — workflow com settle_on", () => {
  it("settle_on SEND: baixa na origem ao enviar; entrada no destino ao receber", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10, 700);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    const r = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        items: [{ productId, quantity: 4 }],
      }),
    );
    expect(r.status).toBe("DRAFT");
    expect(await saldo(tenantId, warehouseId, productId)).toBe(10);

    await withTenant(tenantId, (tx) => sendTransfer(tx, ctx, r.id));
    // material em trânsito: fora dos dois lados
    expect(await saldo(tenantId, warehouseId, productId)).toBe(6);
    expect(await saldo(tenantId, destino, productId)).toBe(0);

    await withTenant(tenantId, (tx) => receiveTransfer(tx, ctx, r.id));
    expect(await saldo(tenantId, warehouseId, productId)).toBe(6);
    expect(await saldo(tenantId, destino, productId)).toBe(4);

    const det = await withTenant(tenantId, (tx) =>
      getTransferDetail(tx, tenantId, r.id),
    );
    expect(det?.status).toBe("RECEIVED");
  });

  it("settle_on RECEIVE: origem mantém o saldo até o recebimento (saída+entrada juntas)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10, 300);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    const r = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "RECEIVE",
        items: [{ productId, quantity: 3 }],
      }),
    );

    await withTenant(tenantId, (tx) => sendTransfer(tx, ctx, r.id));
    // nada saiu ainda
    expect(await saldo(tenantId, warehouseId, productId)).toBe(10);
    expect(await saldo(tenantId, destino, productId)).toBe(0);

    await withTenant(tenantId, (tx) => receiveTransfer(tx, ctx, r.id));
    expect(await saldo(tenantId, warehouseId, productId)).toBe(7);
    expect(await saldo(tenantId, destino, productId)).toBe(3);
  });

  it("cancelar DRAFT não move estoque; cancelar SENT com baixa no envio estorna a origem", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10, 800);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    const r1 = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        items: [{ productId, quantity: 5 }],
      }),
    );
    await withTenant(tenantId, (tx) => cancelTransfer(tx, ctx, r1.id));
    expect(await saldo(tenantId, warehouseId, productId)).toBe(10);

    // SENT + settle_on SEND: cancelar devolve à origem
    const r2 = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        items: [{ productId, quantity: 5 }],
      }),
    );
    await withTenant(tenantId, (tx) => sendTransfer(tx, ctx, r2.id));
    expect(await saldo(tenantId, warehouseId, productId)).toBe(5);
    await withTenant(tenantId, (tx) => cancelTransfer(tx, ctx, r2.id));
    expect(await saldo(tenantId, warehouseId, productId)).toBe(10);
    expect(await saldo(tenantId, destino, productId)).toBe(0);
  });

  it("transições inválidas: receber sem enviar; enviar/mexer em RECEIVED ou CANCELLED", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const destino = await criarUnidade(tenantId, adminId, "DEST");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    const r = await withTenant(tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        items: [{ productId, quantity: 1 }],
      }),
    );

    await expect(
      withTenant(tenantId, (tx) => receiveTransfer(tx, ctx, r.id)),
    ).rejects.toThrow("enviada antes");

    await withTenant(tenantId, (tx) => sendTransfer(tx, ctx, r.id));
    await withTenant(tenantId, (tx) => receiveTransfer(tx, ctx, r.id));

    await expect(
      withTenant(tenantId, (tx) => sendTransfer(tx, ctx, r.id)),
    ).rejects.toThrow(TransferError);
    await expect(
      withTenant(tenantId, (tx) => receiveTransfer(tx, ctx, r.id)),
    ).rejects.toThrow(TransferError);
    await expect(
      withTenant(tenantId, (tx) => cancelTransfer(tx, ctx, r.id)),
    ).rejects.toThrow(TransferError);
  });

  it("origem = destino é recusado", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const { productId } = await createTestProduct(tenantId);

    const ctx = { tenantId, userId: adminId, role: "ADMIN" };
    await expect(
      withTenant(tenantId, (tx) =>
        createTransfer(tx, ctx, {
          fromWarehouseId: warehouseId,
          toWarehouseId: warehouseId,
          settleOn: "SEND",
          items: [{ productId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow("diferentes");
  });
});

describe("transferências — RLS e RBAC", () => {
  it("RLS: empresa B não enxerga transferências/itens da empresa A", async () => {
    const A = await createTestTenant();
    const B = await createTestTenant();
    const adminA = await criarUsuario(A.tenantId, "ADMIN");
    const destino = await criarUnidade(A.tenantId, adminA, "DEST");
    const { productId } = await createTestProduct(A.tenantId);
    await addStock(A.tenantId, A.warehouseId, productId, 10);

    const ctx = { tenantId: A.tenantId, userId: adminA, role: "ADMIN" };
    const r = await withTenant(A.tenantId, (tx) =>
      createTransfer(tx, ctx, {
        fromWarehouseId: A.warehouseId,
        toWarehouseId: destino,
        settleOn: "SEND",
        immediate: true,
        items: [{ productId, quantity: 2 }],
      }),
    );

    const rowsB = await withTenant(B.tenantId, (tx) =>
      tx
        .select()
        .from(transfers)
        .where(
          and(
            eq(transfers.tenantId, A.tenantId),
            eq(transfers.id, r.id),
          ),
        ),
    );
    expect(rowsB).toHaveLength(0);

    const itemsB = await withTenant(B.tenantId, (tx) =>
      tx
        .select()
        .from(transferItems)
        .where(
          and(
            eq(transferItems.tenantId, A.tenantId),
            eq(transferItems.transferId, r.id),
          ),
        ),
    );
    expect(itemsB).toHaveLength(0);

    const detB = await withTenant(B.tenantId, (tx) =>
      getTransferDetail(tx, B.tenantId, r.id),
    );
    expect(detB).toBeNull();
  });

  it("RBAC: stock.transfer negado para VENDEDOR/ESTOQUISTA sem a permissão; matrizes coerentes", () => {
    expect(() => assertPermission("ADMIN", "stock.transfer")).not.toThrow();
    expect(() => assertPermission("GERENTE", "stock.transfer")).not.toThrow();
    expect(() =>
      assertPermission("ESTOQUISTA", "stock.transfer"),
    ).not.toThrow();
    expect(() => assertPermission("VENDEDOR", "stock.transfer")).toThrow(
      PermissionError,
    );
    expect(() =>
      assertPermission("VISUALIZADOR", "stock.transfer"),
    ).toThrow(PermissionError);
    expect(() =>
      assertPermission("FINANCEIRO", "stock.transfer"),
    ).toThrow(PermissionError);
  });

  it("usuário com acesso restrito não transfere a partir de unidade alheia", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const vendedor = await criarUsuario(tenantId, "VENDEDOR");
    const posto = await criarUnidade(tenantId, adminId, "POSTO");
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    // vendedor só enxerga o POSTO
    const { setUnitMembers } = await import(
      "@/server/modules/unidades/warehouse.service"
    );
    await withTenant(tenantId, (tx) =>
      setUnitMembers(tx, {
        tenantId,
        userId: adminId,
        unitId: posto,
        userIds: [vendedor],
      }),
    );

    const ctxV = { tenantId, userId: vendedor, role: "VENDEDOR" };
    await expect(
      withTenant(tenantId, (tx) =>
        createTransfer(tx, ctxV, {
          fromWarehouseId: warehouseId,
          toWarehouseId: posto,
          settleOn: "SEND",
          items: [{ productId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow("não tem acesso");
  });
});
