import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/server/db/client";
import { batches, members, users } from "@/server/db/schema";
import { withTenant } from "@/server/tenant/with-tenant";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import {
  createSale,
  confirmSale,
  billSale,
  type SaleContext,
} from "@/server/modules/vendas/sales.service";
import {
  getAlertSettings,
  getBatchTrace,
  listBatches,
  listExpiryAlerts,
} from "@/server/modules/lotes/batch.service";
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

function ctxFor(tenantId: string, userId: string): SaleContext {
  return {
    tenantId,
    userId,
    role: "ADMIN",
    salesDiscount: true,
  };
}

async function entradaLote(
  tenantId: string,
  warehouseId: string,
  productId: string,
  quantity: number,
  batchNumber: string,
  expiresAt: string | null,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    applyMovement(tx, {
      tenantId,
      type: "ENTRADA_COMPRA",
      productId,
      warehouseId,
      quantity,
      unitCostCents: 1000,
      batchNumber,
      batchExpiresAt: expiresAt,
    }),
  );
}

async function acharLote(
  tenantId: string,
  productId: string,
  batchNumber: string,
): Promise<string> {
  const [b] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, tenantId),
          eq(batches.productId, productId),
          eq(batches.batchNumber, batchNumber),
        ),
      )
      .limit(1),
  );
  if (!b) throw new Error("lote não encontrado");
  return b.id;
}

describe("lotes — listagem e alertas de validade", () => {
  it("lista lotes com saldo por unidade e classifica a validade", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    await criarUsuario(tenantId, "ADMIN");
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
    });

    // validade futura longa (OK) e outra curta (alerta)
    await entradaLote(tenantId, warehouseId, productId, 10, "L-OK", "2030-01-01");
    await entradaLote(tenantId, warehouseId, productId, 5, "L-CURTO", "2026-10-10");

    // janela de alerta: 30 e 90 dias
    await withTenant(tenantId, async (tx) => {
      const { tenantSettings } = await import("@/server/db/schema");
      await tx
        .update(tenantSettings)
        .set({ diasAlertaValidade: [30, 90] })
        .where(eq(tenantSettings.tenantId, tenantId));
    });

    const lotes = await withTenant(tenantId, (tx) =>
      listBatches(tx, tenantId),
    );
    const curto = lotes.find((l) => l.batchNumber === "L-CURTO");
    const ok = lotes.find((l) => l.batchNumber === "L-OK");
    expect(curto?.status).not.toBe("OK");
    expect(curto?.totalQty).toBe(5);
    expect(curto?.warehouses[0]?.name).toBeTruthy();
    expect(ok?.status).toBe("OK");
    expect(ok?.totalQty).toBe(10);

    const alertas = await withTenant(tenantId, (tx) =>
      listExpiryAlerts(tx, tenantId),
    );
    expect(alertas.some((a) => a.batchNumber === "L-CURTO")).toBe(true);
    expect(alertas.some((a) => a.batchNumber === "L-OK")).toBe(false);

    const janelas = await withTenant(tenantId, (tx) =>
      getAlertSettings(tx, tenantId),
    );
    expect(janelas).toEqual([30, 90]);
  });

  it("RLS: empresa B não enxerga lotes da empresa A", async () => {
    const A = await createTestTenant();
    const B = await createTestTenant();
    const { productId } = await createTestProduct(A.tenantId, {
      trackBatch: true,
    });
    await entradaLote(A.tenantId, A.warehouseId, productId, 10, "L-A", "2030-01-01");
    const loteA = await acharLote(A.tenantId, productId, "L-A");

    const lotesB = await withTenant(B.tenantId, (tx) =>
      listBatches(tx, B.tenantId),
    );
    expect(lotesB.some((l) => l.batchId === loteA)).toBe(false);

    const traceB = await withTenant(B.tenantId, (tx) =>
      getBatchTrace(tx, B.tenantId, loteA),
    );
    expect(traceB).toBeNull();
  });
});

describe("lotes — rastreio lote → venda → cliente", () => {
  it("consolida entradas/saídas, vincula vendas e clientes do lote", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const adminId = await criarUsuario(tenantId, "ADMIN");
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: true,
      salePrice: "20.00",
    });
    await entradaLote(tenantId, warehouseId, productId, 20, "L-TRACE", "2027-06-30");

    // venda que consome o lote (FEFO automático na baixa)
    const [customer] = await withTenant(tenantId, async (tx) => {
      const { customers } = await import("@/server/db/schema");
      return tx
        .insert(customers)
        .values({ tenantId, name: "Mercado São João" })
        .returning({ id: customers.id });
    });

    const ctx = ctxFor(tenantId, adminId);
    const sale = await withTenant(tenantId, (tx) =>
      createSale(tx, ctx, {
        warehouseId,
        customerId: customer!.id,
        items: [{ productId, quantity: 3, unitPriceCents: 2000 }],
      }),
    );
    await withTenant(tenantId, (tx) => confirmSale(tx, ctx, sale.saleId));
    await withTenant(tenantId, (tx) => billSale(tx, ctx, sale.saleId));

    const loteId = await acharLote(tenantId, productId, "L-TRACE");
    const trace = await withTenant(tenantId, (tx) =>
      getBatchTrace(tx, tenantId, loteId),
    );

    expect(trace).not.toBeNull();
    expect(trace!.summary.entradas).toBe(20);
    expect(trace!.summary.saidas).toBe(3);
    expect(trace!.summary.saldo).toBe(17);
    expect(trace!.summary.vendas).toBe(1);
    expect(trace!.summary.clientes).toEqual(["Mercado São João"]);

    // movimento de saída traz a venda e o cliente
    const saida = trace!.movements.find((m) => m.type === "SAIDA_VENDA");
    expect(saida?.saleNumber).toBe(sale.number);
    expect(saida?.customerName).toBe("Mercado São João");

    // etiqueta pronta para impressão
    expect(trace!.label.batchNumber).toBe("L-TRACE");
    expect(trace!.label.expiresText).toBe("30/06/2027");
    expect(trace!.label.quantityText).toBe("17");
  });
});
