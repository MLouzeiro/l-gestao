import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  batchBalances,
  batches,
  products,
  stockBalances,
  stockMovements,
} from "@/server/db/schema";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Críticos do AGENTS.md: saldo pelo livro, custo médio, disponibilidade,
// imutabilidade e isolamento entre empresas (RLS).

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

async function countMovements(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(eq(stockMovements.tenantId, tenantId));
    return r?.n ?? 0;
  });
}

async function getProductCost(tenantId: string, productId: string) {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .select({ costPrice: products.costPrice })
      .from(products)
      .where(
        and(eq(products.tenantId, tenantId), eq(products.id, productId)),
      );
    return p?.costPrice ?? null;
  });
}

describe("applyMovement — saldo pelo livro (regra crítica)", () => {
  it("entrada 10 + saída 3 = saldo 7", async () => {
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
    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_AJUSTE",
        productId,
        warehouseId,
        quantity: 3,
        reason: "teste",
      }),
    );

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(7);
    expect(await countMovements(tenantId)).toBe(2);
  });

  it("recusa saída acima do disponível e NÃO grava movimento", async () => {
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

    await expect(
      withTenant(tenantId, (tx) =>
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_AJUSTE",
          productId,
          warehouseId,
          quantity: 11,
        }),
      ),
    ).rejects.toThrow(/insuficiente/i);

    expect(await countMovements(tenantId)).toBe(1);
    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(10);
  });
});

describe("applyMovement — custo médio móvel", () => {
  it("10@R$10 + 10@R$12 → R$11 e saída usa o custo médio", async () => {
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
    expect(await getProductCost(tenantId, productId)).toBe("10.00");

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1200,
      }),
    );
    expect(await getProductCost(tenantId, productId)).toBe("11.00");

    // saída registra unit_cost = média vigente
    await withTenant(tenantId, async (tx) => {
      await applyMovement(tx, {
        tenantId,
        type: "SAIDA_VENDA",
        productId,
        warehouseId,
        quantity: 3,
      });
      const [mv] = await tx
        .select({ unitCost: stockMovements.unitCost })
        .from(stockMovements)
        .where(eq(stockMovements.type, "SAIDA_VENDA"))
        .limit(1);
      expect(mv.unitCost).toBe("11.00");
    });
    // média não muda com saída
    expect(await getProductCost(tenantId, productId)).toBe("11.00");
  });
});

describe("applyMovement — disponibilidade e reserva", () => {
  it("reservado reduz o disponível (100 com 20 reservados → não tira 81)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, async (tx) => {
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 100,
        unitCostCents: 500,
      });
      // reserva de 20 (Fase 10 cria o serviço de reservas; aqui o efeito no
      // saldo é o mesmo)
      await tx
        .update(stockBalances)
        .set({ reserved: "20" })
        .where(eq(stockBalances.tenantId, tenantId));

      await expect(
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_VENDA",
          productId,
          warehouseId,
          quantity: 81,
        }),
      ).rejects.toThrow(/insuficiente/i);

      // 80 disponível exato: passa
      await applyMovement(tx, {
        tenantId,
        type: "SAIDA_VENDA",
        productId,
        warehouseId,
        quantity: 80,
      });
    });

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(20);
    expect(Number(bal?.reserved)).toBe(20);
  });
});

describe("RLS e imutabilidade", () => {
  it("movimento da Empresa A é invisível para a Empresa B (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);

    await withTenant(a.tenantId, (tx) =>
      applyMovement(tx, {
        tenantId: a.tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId: a.warehouseId,
        quantity: 5,
        unitCostCents: 100,
      }),
    );

    const emB = await withTenant(b.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, a.tenantId));
      const sado = await tx
        .select()
        .from(stockBalances)
        .where(eq(stockBalances.tenantId, a.tenantId));
      return { movimentos: rows.length, saldos: sado.length };
    });
    expect(emB.movimentos).toBe(0);
    expect(emB.saldos).toBe(0);
  });

  it("stock_movements é imutável: UPDATE/DELETE não afetam linhas", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    const { movementId } = await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 4,
        unitCostCents: 100,
        reason: "original",
      }),
    );

    await withTenant(tenantId, async (tx) => {
      const upd = await tx
        .update(stockMovements)
        .set({ reason: "hackeado" })
        .where(eq(stockMovements.id, movementId));
      expect(upd.rowCount).toBe(0);

      const del = await tx
        .delete(stockMovements)
        .where(eq(stockMovements.id, movementId));
      expect(del.rowCount).toBe(0);
    });

    // linha continua intacta
    await withTenant(tenantId, async (tx) => {
      const [mv] = await tx
        .select({ reason: stockMovements.reason })
        .from(stockMovements)
        .where(eq(stockMovements.id, movementId));
      expect(mv.reason).toBe("original");
    });
  });
});

describe("applyMovement — lote (controla lote)", () => {
  it("exige lote na entrada/saída e baixa o saldo do lote", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });

    // entrada sem lote → recusada
    await expect(
      withTenant(tenantId, (tx) =>
        applyMovement(tx, {
          tenantId,
          type: "ENTRADA_COMPRA",
          productId,
          warehouseId,
          quantity: 10,
          unitCostCents: 1000,
        }),
      ),
    ).rejects.toThrow(/lote/i);

    // entrada com lote
    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "L001",
        batchExpiresAt: "2027-12-31",
      }),
    );

    await withTenant(tenantId, async (tx) => {
      const [bb] = await tx
        .select()
        .from(batchBalances)
        .where(eq(batchBalances.tenantId, tenantId));
      expect(Number(bb.quantity)).toBe(10);

      const [batch] = await tx
        .select()
        .from(batches)
        .where(eq(batches.tenantId, tenantId));
      expect(batch.batchNumber).toBe("L001");

      // saída maior que o lote → recusada
      await expect(
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_AJUSTE",
          productId,
          warehouseId,
          quantity: 15,
          batchNumber: "L001",
        }),
      ).rejects.toThrow(/lote|insuficiente/i);

      // saída dentro do lote
      await applyMovement(tx, {
        tenantId,
        type: "SAIDA_AJUSTE",
        productId,
        warehouseId,
        quantity: 5,
        batchNumber: "L001",
      });
    });

    await withTenant(tenantId, async (tx) => {
      const [bb] = await tx
        .select()
        .from(batchBalances)
        .where(eq(batchBalances.tenantId, tenantId));
      expect(Number(bb.quantity)).toBe(5);
    });
  });
});
