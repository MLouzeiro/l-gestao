import { and, eq } from "drizzle-orm";
import {
  financialAccounts,
  purchaseEntries,
  stockBalances,
  stockMovements,
  suppliers,
} from "@/server/db/schema";
import {
  PurchaseError,
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  deletePurchase,
  updatePurchase,
} from "@/server/modules/compras/purchase.service";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 11 (M4) — compras: entrada de estoque + conta a pagar na confirmação,
// imutabilidade pós-CONFIRMED, RLS e RBAC.

async function createTestSupplier(tenantId: string): Promise<string> {
  const supplierId = await withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .insert(suppliers)
      .values({ tenantId, name: "Fornecedor Teste" })
      .returning({ id: suppliers.id });
    return s.id;
  });
  return supplierId;
}

function item(
  productId: string,
  over: Partial<{ quantity: number; unitCostCents: number; batchNumber: string; expiresAt: string }> = {},
) {
  return { productId, quantity: 10, unitCostCents: 1000, ...over };
}

async function stockQty(tenantId: string, productId: string, warehouseId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ quantity: stockBalances.quantity })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.productId, productId),
          eq(stockBalances.warehouseId, warehouseId),
        ),
      ),
  );
  return Number(rows[0]?.quantity ?? 0);
}

describe("compras: estoque + conta a pagar na confirmação", () => {
  it("confirmar: estoque sobe, movimento ENTRADA_COMPRA e 1 conta a pagar", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    const created = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        {
          supplierId,
          warehouseId,
          installments: 1,
          items: [item(productId)],
        },
      ),
    );
    expect(created.totalCents).toBe(10000);

    // OPEN não mexe em estoque
    expect(await stockQty(tenantId, productId, warehouseId)).toBe(0);

    const res = await withTenant(tenantId, (tx) =>
      confirmPurchase(tx, { tenantId }, created.purchaseId),
    );
    expect(res.movements).toBe(1);
    expect(res.payables).toBe(1);

    // estoque: 10 unidades + custo médio atualizado
    expect(await stockQty(tenantId, productId, warehouseId)).toBe(10);

    const movs = await withTenant(tenantId, (tx) =>
      tx
        .select({
          type: stockMovements.type,
          unitCost: stockMovements.unitCost,
          totalCost: stockMovements.totalCost,
          referenceId: stockMovements.referenceId,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.referenceId, created.purchaseId),
          ),
        ),
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("ENTRADA_COMPRA");
    expect(movs[0].unitCost).toBe("10.00");
    // 10 un @ R$10,00 = R$100,00 (regression: fórmula do livro)
    expect(movs[0].totalCost).toBe("100.00");

    // conta a pagar
    const accounts = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.tenantId, tenantId),
            eq(financialAccounts.sourceId, created.purchaseId),
          ),
        ),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].direction).toBe("PAYABLE");
    expect(accounts[0].source).toBe("PURCHASE");
    expect(accounts[0].status).toBe("OPEN");
    expect(accounts[0].amount).toBe("100.00");
    expect(accounts[0].description).toBe("COMPRA-000001");

    // nota CONFIRMED
    const [entry] = await withTenant(tenantId, (tx) =>
      tx
        .select({ status: purchaseEntries.status })
        .from(purchaseEntries)
        .where(eq(purchaseEntries.id, created.purchaseId)),
    );
    expect(entry.status).toBe("CONFIRMED");
  });

  it("parcelas 3 geram 3 contas com soma igual ao total", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    const created = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        {
          supplierId,
          warehouseId,
          installments: 3,
          items: [item(productId, { quantity: 7, unitCostCents: 333 })],
        },
      ),
    );
    // 7 * 333 = 2331 centavos
    expect(created.totalCents).toBe(2331);

    await withTenant(tenantId, (tx) =>
      confirmPurchase(tx, { tenantId }, created.purchaseId),
    );

    const accounts = await withTenant(tenantId, (tx) =>
      tx
        .select({ amount: financialAccounts.amount, status: financialAccounts.status })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.tenantId, tenantId),
            eq(financialAccounts.sourceId, created.purchaseId),
          ),
        ),
    );
    expect(accounts).toHaveLength(3);
    const soma = accounts.reduce((s, a) => s + Math.round(parseFloat(a.amount) * 100), 0);
    expect(soma).toBe(2331);
  });

  it("produto que controla lote exige número do lote na nota", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, { trackBatch: true });
    const supplierId = await createTestSupplier(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        createPurchase(
          tx,
          { tenantId },
          { supplierId, warehouseId, installments: 1, items: [item(productId)] },
        ),
      ),
    ).rejects.toThrow(/lote/i);
  });

  it("confirmar duas vezes é recusado (CONFIRMED é final na v1)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    const created = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        { supplierId, warehouseId, installments: 1, items: [item(productId)] },
      ),
    );
    await withTenant(tenantId, (tx) =>
      confirmPurchase(tx, { tenantId }, created.purchaseId),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        confirmPurchase(tx, { tenantId }, created.purchaseId),
      ),
    ).rejects.toThrow(/inválida/i);
  });

  it("cancelar OPEN funciona; confirmada não cancela nem edita", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    const rascunho = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        { supplierId, warehouseId, installments: 1, items: [item(productId)] },
      ),
    );
    await withTenant(tenantId, (tx) =>
      cancelPurchase(tx, { tenantId }, rascunho.purchaseId),
    );

    const confirmada = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        { supplierId, warehouseId, installments: 1, items: [item(productId)] },
      ),
    );
    await withTenant(tenantId, (tx) =>
      confirmPurchase(tx, { tenantId }, confirmada.purchaseId),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        cancelPurchase(tx, { tenantId }, confirmada.purchaseId),
      ),
    ).rejects.toThrow(/estorno|futura/i);
    await expect(
      withTenant(tenantId, (tx) =>
        updatePurchase(
          tx,
          { tenantId },
          confirmada.purchaseId,
          {
            supplierId,
            warehouseId,
            installments: 1,
            items: [item(productId)],
          },
        ),
      ),
    ).rejects.toThrow(/editada/i);
    await expect(
      withTenant(tenantId, (tx) =>
        deletePurchase(tx, { tenantId }, confirmada.purchaseId),
      ),
    ).rejects.toThrow(/editada/i);
  });

  it("entrada manual de estoque (sem compra) NÃO gera conta a pagar", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 5,
        unitCostCents: 2000,
        reason: "Entrada manual",
      }),
    );

    const accounts = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(eq(financialAccounts.tenantId, tenantId)),
    );
    expect(accounts).toHaveLength(0);
    expect(await stockQty(tenantId, productId, warehouseId)).toBe(5);
  });
});

describe("compras: RLS (Empresa A ≠ Empresa B)", () => {
  it("nota da Empresa B é invisível para a Empresa A", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(b.tenantId);
    const supplierId = await createTestSupplier(b.tenantId);

    const notaB = await withTenant(b.tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId: b.tenantId },
        {
          supplierId,
          warehouseId: b.warehouseId,
          installments: 1,
          items: [item(productId)],
        },
      ),
    );

    const vistoDeA = await withTenant(a.tenantId, (tx) =>
      tx
        .select({ id: purchaseEntries.id })
        .from(purchaseEntries)
        .where(
          and(
            eq(purchaseEntries.tenantId, a.tenantId),
            eq(purchaseEntries.id, notaB.purchaseId),
          ),
        ),
    );
    expect(vistoDeA).toHaveLength(0);

    // confirmar de A não acha a nota de B
    await expect(
      withTenant(a.tenantId, (tx) =>
        confirmPurchase(tx, { tenantId: a.tenantId }, notaB.purchaseId),
      ),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe("compras: RBAC (403 no servidor)", () => {
  it("ESTOQUISTA gerencia compras; VENDEDOR e VISUALIZADOR não", () => {
    expect(() => assertPermission("ESTOQUISTA", "purchases.manage")).not.toThrow();
    expect(() => assertPermission("ADMIN", "purchases.manage")).not.toThrow();
    expect(() => assertPermission("VENDEDOR", "purchases.manage")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("VISUALIZADOR", "purchases.manage")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("VISUALIZADOR", "purchases.view")).not.toThrow();
  });

  it("erro do serviço é PurchaseError com mensagem pt-BR", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        createPurchase(
          tx,
          { tenantId },
          {
            supplierId,
            warehouseId,
            installments: 1,
            items: [item(productId, { quantity: 0 })],
          },
        ),
      ),
    ).rejects.toThrow(PurchaseError);
  });
});
