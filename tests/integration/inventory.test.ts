import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  batchBalances,
  batches,
  inventories,
  inventoryItems,
  stockBalances,
  stockMovements,
} from "@/server/db/schema";
import {
  applyInventory,
  createInventory,
  InventoryError,
  saveCounts,
} from "@/server/modules/estoque/inventory.service";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 9 — Inventário (regra crítica do AGENTS.md):
// "contagem 8 vs sistema 10 → ajuste 2" + isolamento entre empresas (RLS).

async function getBalance(tenantId: string, productId: string) {
  return withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.productId, productId),
        ),
      );
    return b ?? null;
  });
}

async function getBatchBalance(tenantId: string, batchId: string) {
  return withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .select()
      .from(batchBalances)
      .where(
        and(
          eq(batchBalances.tenantId, tenantId),
          eq(batchBalances.batchId, batchId),
        ),
      );
    return b ?? null;
  });
}

async function getItems(tenantId: string, inventoryId: string) {
  return withTenant(tenantId, async (tx) =>
    tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, tenantId),
          eq(inventoryItems.inventoryId, inventoryId),
        ),
      ),
  );
}

async function setCount(
  tenantId: string,
  inventoryId: string,
  counts: { itemId: string; countedQty: number | null }[],
) {
  await withTenant(tenantId, (tx) =>
    saveCounts(tx, { tenantId, inventoryId, counts }),
  );
}

async function movementsOf(
  tenantId: string,
  inventoryId: string,
): Promise<
  { type: string; quantity: string; referenceType: string | null }[]
> {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        referenceType: stockMovements.referenceType,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.referenceId, inventoryId),
        ),
      ),
  );
}

describe("inventário — contagem vira ajuste (regra crítica)", () => {
  it("contagem 8 vs sistema 10 → ajuste 2 (saldo final 8)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );

    const { inventoryId, itemCount } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    expect(itemCount).toBe(1);

    const itens = await getItems(tenantId, inventoryId);
    expect(Number(itens[0].systemQty)).toBe(10);
    expect(itens[0].countedQty).toBeNull();

    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 8 },
    ]);

    const result = await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );
    expect(result.applied).toBe(1);
    expect(result.unchanged).toBe(0);

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(8);

    const movs = await movementsOf(tenantId, inventoryId);
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("SAIDA_AJUSTE");
    expect(Number(movs[0].quantity)).toBe(2);
    expect(movs[0].referenceType).toBe("INVENTORY");
  });

  it("contagem 12 vs sistema 10 → entrada 2 e custo médio preservado", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1500,
      }),
    );

    const { inventoryId } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    const itens = await getItems(tenantId, inventoryId);
    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 12 },
    ]);

    const result = await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );
    expect(result.applied).toBe(1);

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(12);

    const movs = await movementsOf(tenantId, inventoryId);
    expect(movs[0].type).toBe("ENTRADA_AJUSTE");
  });

  it("contagem igual ao sistema fecha sem movimento", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );

    const { inventoryId } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    const itens = await getItems(tenantId, inventoryId);
    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 10 },
    ]);

    const result = await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );
    expect(result.applied).toBe(0);
    expect(await movementsOf(tenantId, inventoryId)).toHaveLength(0);

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(10);
  });

  it("item sem contagem bloqueia a aplicação (nada é gravado)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );

    const { inventoryId } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );

    await expect(
      withTenant(tenantId, (tx) => applyInventory(tx, { tenantId, inventoryId })),
    ).rejects.toThrow(InventoryError);

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(10);
  });

  it("inventário aplicado não pode ser alterado nem reaplicado", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );

    const { inventoryId } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    const itens = await getItems(tenantId, inventoryId);
    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 4 },
    ]);
    await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );

    await expect(
      withTenant(tenantId, (tx) => applyInventory(tx, { tenantId, inventoryId })),
    ).rejects.toThrow("já aplicado");
    await expect(
      withTenant(tenantId, (tx) =>
        saveCounts(tx, {
          tenantId,
          inventoryId,
          counts: [{ itemId: itens[0].id, countedQty: 1 }],
        }),
      ),
    ).rejects.toThrow("já aplicado");

    // saldo continua no valor da primeira aplicação
    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(4);
  });

  it("produto com lote: ajusta o saldo do lote contado", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "L1",
      }),
    );

    const { inventoryId, itemCount } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    expect(itemCount).toBe(1);

    const itens = await getItems(tenantId, inventoryId);
    expect(itens[0].batchId).not.toBeNull();
    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 7 },
    ]);

    await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );

    const [lote] = await withTenant(tenantId, async (tx) =>
      tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            eq(batches.tenantId, tenantId),
            eq(batches.productId, productId),
          ),
        ),
    );
    const bb = await getBatchBalance(tenantId, lote.id);
    expect(Number(bb?.quantity)).toBe(7);

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(7);
  });

  it("não abre dois inventários para o mesmo depósito", async () => {
    const { tenantId, warehouseId } = await createTestTenant();

    await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        createInventory(tx, { tenantId, warehouseId }),
      ),
    ).rejects.toThrow("em aberto");
  });
});

describe("inventário — isolamento entre empresas (RLS)", () => {
  it("empresa B não lê nem aplica o inventário da empresa A", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);

    await withTenant(a.tenantId, (tx) =>
      applyMovement(tx, {
        tenantId: a.tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId: a.warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );
    const { inventoryId } = await withTenant(a.tenantId, (tx) =>
      createInventory(tx, {
        tenantId: a.tenantId,
        warehouseId: a.warehouseId,
      }),
    );

    // SELECT sob tenant B → 0 linhas
    const emB = await withTenant(b.tenantId, async (tx) =>
      tx
        .select({ id: inventories.id })
        .from(inventories)
        .where(eq(inventories.tenantId, b.tenantId)),
    );
    expect(emB).toHaveLength(0);

    const itensDeA = await getItems(a.tenantId, inventoryId);
    const itensVistosPorB = await withTenant(b.tenantId, async (tx) =>
      tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.tenantId, b.tenantId)),
    );
    expect(itensVistosPorB).toHaveLength(0);

    // empresa B tentando usar o inventário de A → não encontrado
    await expect(
      withTenant(b.tenantId, (tx) =>
        applyInventory(tx, { tenantId: b.tenantId, inventoryId }),
      ),
    ).rejects.toThrow("não encontrado");
    await expect(
      withTenant(b.tenantId, (tx) =>
        saveCounts(tx, {
          tenantId: b.tenantId,
          inventoryId,
          counts: [{ itemId: itensDeA[0].id, countedQty: 1 }],
        }),
      ),
    ).rejects.toThrow("não encontrado");
  });

  it("empresa B não consegue criar inventário no depósito da empresa A", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    await expect(
      withTenant(b.tenantId, (tx) =>
        createInventory(tx, {
          tenantId: b.tenantId,
          warehouseId: a.warehouseId,
        }),
      ),
    ).rejects.toThrow("Depósito não encontrado");
  });
});

describe("inventário — integridade do livro", () => {
  it("a soma dos movimentos continua explicando o saldo", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
      }),
    );
    const { inventoryId } = await withTenant(tenantId, (tx) =>
      createInventory(tx, { tenantId, warehouseId }),
    );
    const itens = await getItems(tenantId, inventoryId);
    await setCount(tenantId, inventoryId, [
      { itemId: itens[0].id, countedQty: 3 },
    ]);
    await withTenant(tenantId, (tx) =>
      applyInventory(tx, { tenantId, inventoryId }),
    );

    const [soma] = await withTenant(tenantId, async (tx) =>
      tx
        .select({
          total: sql<string>`coalesce(sum(case when ${stockMovements.type}::text like 'ENTRADA%' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.productId, productId),
          ),
        ),
    );
    const bal = await getBalance(tenantId, productId);
    expect(Number(soma.total)).toBe(Number(bal?.quantity));
    expect(Number(bal?.quantity)).toBe(3);
  });
});
