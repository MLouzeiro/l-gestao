import { eq } from "drizzle-orm";
import { financialAccounts, products } from "@/server/db/schema";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import {
  billSale,
  confirmSale,
  createSale,
} from "@/server/modules/vendas/sales.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 13 (M5) — dashboard: RLS A ≠ B, agregados batem (faturamento, série
// diária, funil, estoque, inadimplência, próximos vencimentos), período e
// RBAC de reports.view.

function ctxFor(tenantId: string) {
  return { tenantId, userId: null, role: "ADMIN", salesDiscount: true };
}

function utcToday(): string {
  // Dia de negócio = dia local (mesma convenção de asUtcDay/localDayKey).
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isoDaysAgo(n: number): string {
  const today = utcToday();
  return new Date(
    Date.parse(`${today}T00:00:00Z`) - n * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

async function addStock(
  tenantId: string,
  warehouseId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    applyMovement(tx, {
      tenantId,
      type: "ENTRADA_COMPRA",
      productId,
      warehouseId,
      quantity,
      unitCostCents: 1000,
    }),
  );
}

async function faturar(
  tenantId: string,
  warehouseId: string,
  productId: string,
  opts: { installments?: number; quantity?: number; unitPriceCents?: number } = {},
): Promise<string> {
  const { saleId } = await withTenant(tenantId, async (tx) => {
    const r = await createSale(tx, ctxFor(tenantId), {
      warehouseId,
      installments: opts.installments ?? 1,
      items: [
        {
          productId,
          quantity: opts.quantity ?? 3,
          unitPriceCents: opts.unitPriceCents ?? 2000,
        },
      ],
    });
    await confirmSale(tx, ctxFor(tenantId), r.saleId);
    await billSale(tx, ctxFor(tenantId), r.saleId);
    return { saleId: r.saleId };
  });
  return saleId;
}

async function fixtureVenda(
  tenantId: string,
  warehouseId: string,
): Promise<{ productId: string }> {
  const { productId } = await createTestProduct(tenantId);
  await addStock(tenantId, warehouseId, productId, 10);
  await faturar(tenantId, warehouseId, productId);
  return { productId };
}

describe("dashboard: RLS (tenant A ≠ B)", () => {
  it("B sem dados vê tudo zerado mesmo com dados de A", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    await fixtureVenda(a.tenantId, a.warehouseId);

    const dashA = await withTenant(a.tenantId, (tx) =>
      getDashboard(tx, a.tenantId, { de: isoDaysAgo(6), ate: utcToday() }),
    );
    expect(dashA.sales.netCents).toBe(6000);
    expect(dashA.funnel.total).toBe(1);
    expect(dashA.stock.items).toBeGreaterThan(0);

    const dashB = await withTenant(b.tenantId, (tx) =>
      getDashboard(tx, b.tenantId, { de: isoDaysAgo(6), ate: utcToday() }),
    );
    expect(dashB.sales.netCents).toBe(0);
    expect(dashB.sales.billedOrders).toBe(0);
    expect(dashB.funnel.total).toBe(0);
    expect(dashB.stock.items).toBe(0);
    expect(dashB.stock.valueCents).toBe(0);
    expect(dashB.topSellers).toHaveLength(0);
    expect(dashB.nextDue).toHaveLength(0);
    expect(dashB.series.every((p) => p.netCents === 0)).toBe(true);
  });

  it("B com dados próprios vê só os números de B", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    await fixtureVenda(a.tenantId, a.warehouseId);

    const { productId } = await createTestProduct(b.tenantId);
    await addStock(b.tenantId, b.warehouseId, productId, 5);
    await faturar(b.tenantId, b.warehouseId, productId, {
      quantity: 2,
      unitPriceCents: 1000,
    });

    const dashB = await withTenant(b.tenantId, (tx) =>
      getDashboard(tx, b.tenantId, { de: isoDaysAgo(6), ate: utcToday() }),
    );
    expect(dashB.sales.netCents).toBe(2000);
    expect(dashB.sales.billedOrders).toBe(1);
    expect(dashB.funnel.total).toBe(1);
    expect(dashB.stock.valueCents).toBe(3000); // 5 − 2 faturados = 3 @ 10,00
    expect(dashB.series.find((p) => p.day === utcToday())?.netCents).toBe(2000);
  });
});

describe("dashboard: agregados do período", () => {
  it("faturamento, ticket, série diária, funil, estoque e próximos vencimentos batem", async () => {
    const { tenantId, warehouseId } = await createTestTenant();

    const { productId: pCritico } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, pCritico, 5);
    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "SAIDA_AJUSTE",
        productId: pCritico,
        warehouseId,
        quantity: 5,
      }),
    );

    const { productId: pBaixo } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, pBaixo, 10);
    await withTenant(tenantId, (tx) =>
      tx
        .update(products)
        .set({ minStock: "100" })
        .where(eq(products.id, pBaixo)),
    );

    await faturar(tenantId, warehouseId, pBaixo, {
      quantity: 3,
      unitPriceCents: 2000,
    });

    const dash = await withTenant(tenantId, (tx) =>
      getDashboard(tx, tenantId, { de: isoDaysAgo(6), ate: utcToday() }),
    );

    expect(dash.period).toMatchObject({
      de: isoDaysAgo(6),
      ate: utcToday(),
      days: 7,
    });

    expect(dash.sales).toMatchObject({
      billedOrders: 1,
      netCents: 6000,
      ticketAvgCents: 6000,
    });

    expect(dash.series).toHaveLength(7);
    const hoje = dash.series.find((p) => p.day === utcToday());
    expect(hoje).toMatchObject({ netCents: 6000, orders: 1 });
    const ontem = dash.series.find((p) => p.day === isoDaysAgo(1));
    expect(ontem).toMatchObject({ netCents: 0, orders: 0 });

    expect(dash.funnel).toEqual({
      DRAFT: 0,
      CONFIRMED: 0,
      BILLED: 1,
      CANCELLED: 0,
      RETURNED: 0,
      total: 1,
    });

    expect(dash.stock).toMatchObject({
      items: 2,
      critical: 1,
      low: 1,
      valueCents: 7000, // 10 − 3 faturados = 7 @ 10,00 + crítico 0
    });

    expect(dash.topSellers).toHaveLength(1);
    expect(dash.topSellers[0]).toMatchObject({ orders: 1, netCents: 6000 });

    expect(dash.finance).toMatchObject({
      overdueCount: 0,
      overdueCents: 0,
      openCents: 6000,
    });
    expect(dash.nextDue).toHaveLength(1);
    expect(dash.nextDue[0]).toMatchObject({
      status: "OPEN",
      dueDate: utcToday(),
      openCents: 6000,
    });
  });

  it("parcela vencida vira inadimplência e sai dos próximos vencimentos", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    await faturar(tenantId, warehouseId, productId, {
      installments: 3,
      quantity: 3,
      unitPriceCents: 2000, // 3x R$ 20,00
    });

    const abertas = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: financialAccounts.id, n: financialAccounts.installmentNumber })
        .from(financialAccounts)
        .where(eq(financialAccounts.tenantId, tenantId))
        .orderBy(financialAccounts.installmentNumber),
    );
    expect(abertas).toHaveLength(3);
    const ontem = new Date(
      Date.parse(`${isoDaysAgo(1)}T00:00:00.000Z`),
    );
    await withTenant(tenantId, (tx) =>
      tx
        .update(financialAccounts)
        .set({ dueDate: ontem })
        .where(eq(financialAccounts.id, abertas[0].id)),
    );

    const dash = await withTenant(tenantId, (tx) =>
      getDashboard(tx, tenantId, { de: isoDaysAgo(6), ate: utcToday() }),
    );

    expect(dash.finance).toMatchObject({
      overdueCount: 1,
      overdueCents: 2000,
      openCents: 6000,
    });
    expect(dash.nextDue).toHaveLength(2);
    expect(dash.nextDue[0].dueDate > utcToday()).toBe(true);
    expect(dash.nextDue[1].dueDate > dash.nextDue[0].dueDate).toBe(true);
    expect(dash.nextDue.every((a) => a.openCents === 2000)).toBe(true);
  });

  it("período fora zera vendas/funil, mas estoque continua na posição atual", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    await fixtureVenda(tenantId, warehouseId);

    const dash = await withTenant(tenantId, (tx) =>
      getDashboard(tx, tenantId, { de: "2020-01-01", ate: "2020-01-31" }),
    );
    expect(dash.series).toHaveLength(31);
    expect(dash.series.every((p) => p.netCents === 0)).toBe(true);
    expect(dash.sales).toMatchObject({ billedOrders: 0, netCents: 0 });
    expect(dash.sales.ticketAvgCents).toBeNull();
    expect(dash.funnel.total).toBe(0);
    expect(dash.topSellers).toHaveLength(0);
    expect(dash.stock.items).toBe(1);
    expect(dash.stock.valueCents).toBe(7000); // 10 − 3 faturados = 7 @ 10,00
  });
});

describe("dashboard: RBAC (reports.view)", () => {
  it("ADMIN, GERENTE, FINANCEIRO e VISUALIZADOR veem o dashboard", () => {
    expect(() => assertPermission("ADMIN", "reports.view")).not.toThrow();
    expect(() => assertPermission("GERENTE", "reports.view")).not.toThrow();
    expect(() => assertPermission("FINANCEIRO", "reports.view")).not.toThrow();
    expect(() => assertPermission("VISUALIZADOR", "reports.view")).not.toThrow();
  });

  it("VENDEDOR e ESTOQUISTA recebem 403 no servidor", () => {
    expect(() => assertPermission("VENDEDOR", "reports.view")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("ESTOQUISTA", "reports.view")).toThrow(
      PermissionError,
    );
  });
});
