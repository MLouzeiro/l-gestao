import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  batchBalances,
  batches,
  stockMovements,
  tenantSettings,
} from "@/server/db/schema";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Críticos do AGENTS.md (Fase 8):
// - "Venda usa lote FEFO quando controle_fefo ativo"
// - "Lote vencido é bloqueado quando bloqueio_venda_vencido ativo"

async function setFlags(
  tenantId: string,
  flags: { controleFefo?: boolean; bloqueioVendaVencido?: boolean },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(tenantSettings)
      .set({ ...flags, updatedAt: new Date() })
      .where(eq(tenantSettings.tenantId, tenantId)),
  );
}

async function getBatchInfo(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        number: batches.batchNumber,
        expiresAt: batches.expiresAt,
        qty: batchBalances.quantity,
      })
      .from(batches)
      .leftJoin(
        batchBalances,
        and(
          eq(batchBalances.batchId, batches.id),
          eq(batchBalances.tenantId, batches.tenantId),
        ),
      )
      .where(eq(batches.tenantId, tenantId));
    return rows;
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

async function saidaBatchUsado(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ number: batches.batchNumber })
      .from(stockMovements)
      .innerJoin(
        batches,
        and(
          eq(batches.id, stockMovements.batchId),
          eq(batches.tenantId, stockMovements.tenantId),
        ),
      )
      .where(eq(stockMovements.type, "SAIDA_VENDA"))
      .limit(1);
    return row?.number ?? null;
  });
}

describe("FEFO — saída automática (controle_fefo ativo)", () => {
  it("sem controle_fefo, saída de produto com lote sem informar lote é recusada", async () => {
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
        batchExpiresAt: "2027-06-30",
      }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_VENDA",
          productId,
          warehouseId,
          quantity: 5,
        }),
      ),
    ).rejects.toThrow(/lote/i);
  });

  it("com controle_fefo, saída sem lote usa o de validade mais próxima", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });
    await setFlags(tenantId, { controleFefo: true });

    // dois lotes: o mais próximo vence primeiro
    await withTenant(tenantId, async (tx) => {
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "FUTURO",
        batchExpiresAt: "2027-06-30",
      });
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "PERTO",
        batchExpiresAt: "2026-10-31",
      });
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_VENDA",
        productId,
        warehouseId,
        quantity: 5,
      }),
    );

    expect(await saidaBatchUsado(tenantId)).toBe("PERTO");
    const lotes = await getBatchInfo(tenantId);
    const perto = lotes.find((l) => l.number === "PERTO");
    const futuro = lotes.find((l) => l.number === "FUTURO");
    expect(Number(perto?.qty)).toBe(5);
    expect(Number(futuro?.qty)).toBe(10);
  });
});

describe("bloqueio_venda_vencido", () => {
  it("SAIDA_VENDA de lote vencido é bloqueada e não grava movimento", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });
    await setFlags(tenantId, {
      controleFefo: true,
      bloqueioVendaVencido: true,
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VENC",
        batchExpiresAt: "2026-01-01",
      }),
    );
    const antes = await countMovements(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_VENDA",
          productId,
          warehouseId,
          quantity: 5,
          batchNumber: "VENC",
        }),
      ),
    ).rejects.toThrow(/vencido/i);

    expect(await countMovements(tenantId)).toBe(antes);
    const lotes = await getBatchInfo(tenantId);
    expect(Number(lotes.find((l) => l.number === "VENC")?.qty)).toBe(10);
  });

  it("SAIDA_PERDA do lote vencido continua permitida (baixa operacional)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });
    await setFlags(tenantId, {
      controleFefo: true,
      bloqueioVendaVencido: true,
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VENC",
        batchExpiresAt: "2026-01-01",
      }),
    );

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_PERDA",
        productId,
        warehouseId,
        quantity: 4,
        batchNumber: "VENC",
        reason: "descarte de vencido",
      }),
    );

    const lotes = await getBatchInfo(tenantId);
    expect(Number(lotes.find((l) => l.number === "VENC")?.qty)).toBe(6);
  });

  it("com bloqueio ativo, o FEFO pula o vencido e usa o válido", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });
    await setFlags(tenantId, {
      controleFefo: true,
      bloqueioVendaVencido: true,
    });

    await withTenant(tenantId, async (tx) => {
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VENC",
        batchExpiresAt: "2026-01-01",
      });
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VALIDO",
        batchExpiresAt: "2027-06-30",
      });
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_VENDA",
        productId,
        warehouseId,
        quantity: 5,
      }),
    );

    expect(await saidaBatchUsado(tenantId)).toBe("VALIDO");
    const lotes = await getBatchInfo(tenantId);
    expect(Number(lotes.find((l) => l.number === "VENC")?.qty)).toBe(10);
    expect(Number(lotes.find((l) => l.number === "VALIDO")?.qty)).toBe(5);
  });

  it("sem bloqueio, FEFO entrega o vencido primeiro", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });
    await setFlags(tenantId, { controleFefo: true });

    await withTenant(tenantId, async (tx) => {
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VENC",
        batchExpiresAt: "2026-01-01",
      });
      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "VALIDO",
        batchExpiresAt: "2027-06-30",
      });
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_VENDA",
        productId,
        warehouseId,
        quantity: 5,
      }),
    );

    expect(await saidaBatchUsado(tenantId)).toBe("VENC");
  });
});

describe("RLS — lotes", () => {
  it("lotes da Empresa A são invisíveis para Empresa B (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId, {
      trackBatch: true,
    });

    await withTenant(a.tenantId, (tx) =>
      applyMovement(tx, {
        tenantId: a.tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId: a.warehouseId,
        quantity: 10,
        unitCostCents: 1000,
        batchNumber: "DE-A",
        batchExpiresAt: "2027-06-30",
      }),
    );

    const emB = await withTenant(b.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(batches)
        .where(eq(batches.tenantId, a.tenantId));
      return rows.length;
    });
    expect(emB).toBe(0);
  });
});
