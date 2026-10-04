import { eq } from "drizzle-orm";
import { products, suppliers } from "@/server/db/schema";
import {
  getFinanceReport,
  getPurchasesReport,
  getSalesReport,
  getStockReport,
} from "@/server/modules/relatorios/report.service";
import {
  createPurchase,
  confirmPurchase,
} from "@/server/modules/compras/purchase.service";
import { registerPayment } from "@/server/modules/financeiro/financial.service";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { billSale, confirmSale, createSale } from "@/server/modules/vendas/sales.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 12 (M5) — relatórios: RLS A ≠ B, agregados batem com o livro de
// estoque/financeiro, paginação vs `all` (CSV) e RBAC de reports.view.

function ctxFor(tenantId: string) {
  return { tenantId, userId: null, role: "ADMIN", salesDiscount: true };
}

const PAGE = { page: 1, pageSize: 20 };

/** dia local "YYYY-MM-DD" (dueDate é gravado na meia-noite local) */
function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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

async function createTestSupplier(tenantId: string): Promise<string> {
  const supplierId = await withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .insert(suppliers)
      .values({ tenantId, name: "Fornecedor Relatórios" })
      .returning({ id: suppliers.id });
    return s.id;
  });
  return supplierId;
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

describe("relatórios: estoque (RLS, agregado e paginação)", () => {
  it("tenant B não enxerga saldos de tenant A e A soma o estoque certo", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId, sku } = await createTestProduct(a.tenantId);
    await addStock(a.tenantId, a.warehouseId, productId, 10);

    const relA = await withTenant(a.tenantId, (tx) =>
      getStockReport(tx, a.tenantId, { ...PAGE, q: sku }),
    );
    expect(relA.total).toBe(1);
    expect(relA.rows[0]).toMatchObject({
      sku,
      quantity: 10,
      available: 10,
      minStock: 0,
      costCents: 1000,
      valueCents: 10000,
      level: "OK",
    });
    expect(relA.summary).toMatchObject({
      items: 1,
      valueCents: 10000,
      critical: 0,
      low: 0,
      ok: 1,
    });

    const relB = await withTenant(b.tenantId, (tx) =>
      getStockReport(tx, b.tenantId, { ...PAGE, q: sku }),
    );
    expect(relB.total).toBe(0);
    expect(relB.rows).toHaveLength(0);

    const relBLivre = await withTenant(b.tenantId, (tx) =>
      getStockReport(tx, b.tenantId, PAGE),
    );
    expect(relBLivre.rows.some((r) => r.sku === sku)).toBe(false);
  });

  it("classificação BAIXO pelo mínimo e filtro de nível", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId, sku } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    await withTenant(tenantId, (tx) =>
      tx.update(products).set({ minStock: "100" }).where(eq(products.id, productId)),
    );

    const rel = await withTenant(tenantId, (tx) =>
      getStockReport(tx, tenantId, { ...PAGE, level: "BAIXO" }),
    );
    expect(rel.total).toBe(1);
    expect(rel.rows[0]).toMatchObject({ sku, level: "BAIXO", minStock: 100 });

    const ok = await withTenant(tenantId, (tx) =>
      getStockReport(tx, tenantId, { ...PAGE, level: "OK" }),
    );
    expect(ok.total).toBe(0);
  });

  it("paginação padrão corta as linhas; `all` devolve tudo (CSV)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId: p1 } = await createTestProduct(tenantId);
    const { productId: p2 } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, p1, 5);
    await addStock(tenantId, warehouseId, p2, 7);

    const pag = await withTenant(tenantId, (tx) =>
      getStockReport(tx, tenantId, { page: 1, pageSize: 1 }),
    );
    expect(pag.total).toBe(2);
    expect(pag.rows).toHaveLength(1);

    const all = await withTenant(tenantId, (tx) =>
      getStockReport(tx, tenantId, { page: 1, pageSize: 1 }, { all: true }),
    );
    expect(all.total).toBe(2);
    expect(all.rows).toHaveLength(2);
  });
});

describe("relatórios: vendas faturadas", () => {
  it("soma faturamento, custo (SAIDA_VENDA) e margem por dia", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    await faturar(tenantId, warehouseId, productId, {
      quantity: 3,
      unitPriceCents: 2000,
    });

    const rel = await withTenant(tenantId, (tx) =>
      getSalesReport(tx, tenantId, { ...PAGE, groupBy: "dia" }),
    );
    expect(rel.summary).toMatchObject({
      orders: 1,
      quantity: 3,
      grossCents: 6000,
      discountCents: 0,
      netCents: 6000,
      costCents: 3000,
      marginCents: 3000,
      marginPct: 100,
    });
    expect(rel.total).toBe(1);
    expect(rel.rows[0]).toMatchObject({
      key: todayLocal(),
      orders: 1,
      quantity: 3,
      netCents: 6000,
      costCents: 3000,
    });

    const porProduto = await withTenant(tenantId, (tx) =>
      getSalesReport(tx, tenantId, { ...PAGE, groupBy: "produto" }),
    );
    expect(porProduto.total).toBe(1);
    expect(porProduto.rows[0]).toMatchObject({
      key: "Produto Teste",
      quantity: 3,
      netCents: 6000,
      costCents: 3000,
    });

    const outroDia = await withTenant(tenantId, (tx) =>
      getSalesReport(tx, tenantId, { ...PAGE, groupBy: "dia", de: todayLocal(), ate: todayLocal() }),
    );
    expect(outroDia.summary.orders).toBe(1);

    const foraDoPeriodo = await withTenant(tenantId, (tx) =>
      getSalesReport(tx, tenantId, {
        ...PAGE,
        groupBy: "dia",
        de: "2020-01-01",
        ate: "2020-01-31",
      }),
    );
    expect(foraDoPeriodo.summary.orders).toBe(0);
    expect(foraDoPeriodo.rows).toHaveLength(0);
  });

  it("RLS: vendas de A não aparecem para B", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);
    await addStock(a.tenantId, a.warehouseId, productId, 10);
    await faturar(a.tenantId, a.warehouseId, productId);

    const relA = await withTenant(a.tenantId, (tx) =>
      getSalesReport(tx, a.tenantId, { ...PAGE, groupBy: "dia" }),
    );
    expect(relA.summary.orders).toBe(1);

    const relB = await withTenant(b.tenantId, (tx) =>
      getSalesReport(tx, b.tenantId, { ...PAGE, groupBy: "dia" }),
    );
    expect(relB.summary.orders).toBe(0);
    expect(relB.rows).toHaveLength(0);
  });
});

describe("relatórios: compras", () => {
  it("só CONFIRMED conta; agrupa por fornecedor e por produto", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    const supplierId = await createTestSupplier(tenantId);

    await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        {
          supplierId,
          warehouseId,
          installments: 1,
          items: [{ productId, quantity: 10, unitCostCents: 1000 }],
        },
      ),
    );
    const segunda = await withTenant(tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId },
        {
          supplierId,
          warehouseId,
          installments: 1,
          items: [{ productId, quantity: 5, unitCostCents: 500 }],
        },
      ),
    );

    const antes = await withTenant(tenantId, (tx) =>
      getPurchasesReport(tx, tenantId, { ...PAGE, groupBy: "fornecedor" }),
    );
    expect(antes.summary.orders).toBe(0);
    expect(antes.summary.totalCents).toBe(0);

    await withTenant(tenantId, (tx) =>
      confirmPurchase(tx, { tenantId }, segunda.purchaseId),
    );

    const depois = await withTenant(tenantId, (tx) =>
      getPurchasesReport(tx, tenantId, { ...PAGE, groupBy: "fornecedor" }),
    );
    expect(depois.summary).toMatchObject({ orders: 1, totalCents: 2500 });
    expect(depois.total).toBe(1);
    expect(depois.rows[0]).toMatchObject({ orders: 1, totalCents: 2500 });

    const porProduto = await withTenant(tenantId, (tx) =>
      getPurchasesReport(tx, tenantId, { ...PAGE, groupBy: "produto" }),
    );
    expect(porProduto.rows[0]).toMatchObject({ quantity: 5, totalCents: 2500 });

    // estoque entrou na confirmação (5 @ 5,00 = 25,00; custo médio 10@10 + 5@5)
    const relEstoque = await withTenant(tenantId, (tx) =>
      getStockReport(tx, tenantId, { ...PAGE }),
    );
    expect(relEstoque.rows[0]?.quantity).toBe(5);
  });

  it("RLS: compras de A não aparecem para B", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);
    const supplierId = await createTestSupplier(a.tenantId);

    const created = await withTenant(a.tenantId, (tx) =>
      createPurchase(
        tx,
        { tenantId: a.tenantId },
        {
          supplierId,
          warehouseId: a.warehouseId,
          installments: 1,
          items: [{ productId, quantity: 10, unitCostCents: 1000 }],
        },
      ),
    );
    await withTenant(a.tenantId, (tx) =>
      confirmPurchase(tx, { tenantId: a.tenantId }, created.purchaseId),
    );

    const relA = await withTenant(a.tenantId, (tx) =>
      getPurchasesReport(tx, a.tenantId, { ...PAGE, groupBy: "fornecedor" }),
    );
    expect(relA.summary.orders).toBe(1);

    const relB = await withTenant(b.tenantId, (tx) =>
      getPurchasesReport(tx, b.tenantId, { ...PAGE, groupBy: "fornecedor" }),
    );
    expect(relB.summary.orders).toBe(0);
    expect(relB.rows).toHaveLength(0);
  });
});

describe("relatórios: financeiro", () => {
  it("parcelas, baixa parcial e resumo batem com o período", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    const saleId = await faturar(tenantId, warehouseId, productId, {
      installments: 3,
      quantity: 3,
      unitPriceCents: 2000, // total R$ 60,00 em 3x
    });
    void saleId;

    const aberto = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, { ...PAGE, direction: "RECEIVABLE" }),
    );
    expect(aberto.total).toBe(3);
    expect(aberto.summary.accounts.byStatus.OPEN.count).toBe(3);
    expect(aberto.summary.accounts.openCents).toBe(6000);
    expect(aberto.summary.payments.count).toBe(0);

    const hoje = todayLocal();
    const primeira = aberto.rows.find(
      (r) => r.installmentNumber === 1,
    );
    expect(primeira).toBeDefined();

    await withTenant(tenantId, (tx) =>
      registerPayment(tx, ctxFor(tenantId), primeira!.accountId, {
        amountCents: 1000, // parcela de 2000 → baixa parcial
        paymentMethod: "PIX",
      }),
    );

    const comBaixa = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, {
        ...PAGE,
        direction: "RECEIVABLE",
        de: "2000-01-01",
        ate: "2099-12-31",
      }),
    );
    expect(comBaixa.total).toBe(3);
    expect(comBaixa.summary.accounts.byStatus.PARTIAL).toMatchObject({
      count: 1,
      paidCents: 1000,
    });
    expect(comBaixa.summary.accounts.openCents).toBe(5000);
    expect(comBaixa.summary.payments).toMatchObject({
      count: 1,
      amountCents: 1000,
    });

    // período = hoje: só a 1ª parcela vence hoje (as demais são do mês seguinte)
    const noDia = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, {
        ...PAGE,
        direction: "RECEIVABLE",
        de: hoje,
        ate: hoje,
      }),
    );
    expect(noDia.total).toBe(1);
    expect(noDia.rows[0]?.accountId).toBe(primeira!.accountId);

    const soPagas = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, {
        ...PAGE,
        direction: "RECEIVABLE",
        status: "PARTIAL",
      }),
    );
    expect(soPagas.total).toBe(1);
    expect(soPagas.rows[0]?.paidCents).toBe(1000);

    const pagar = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, { ...PAGE, direction: "PAYABLE" }),
    );
    expect(pagar.total).toBe(0);
    expect(pagar.summary.accounts.openCents).toBe(0);
  });

  it("RLS: contas de A não aparecem para B", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);
    await addStock(a.tenantId, a.warehouseId, productId, 10);
    await faturar(a.tenantId, a.warehouseId, productId);

    const relA = await withTenant(a.tenantId, (tx) =>
      getFinanceReport(tx, a.tenantId, { ...PAGE, direction: "RECEIVABLE" }),
    );
    expect(relA.total).toBeGreaterThan(0);

    const relB = await withTenant(b.tenantId, (tx) =>
      getFinanceReport(tx, b.tenantId, { ...PAGE, direction: "RECEIVABLE" }),
    );
    expect(relB.total).toBe(0);
    expect(relB.rows).toHaveLength(0);
    expect(relB.summary.accounts.openCents).toBe(0);
  });
});

describe("relatórios: RBAC (reports.view)", () => {
  it("ADMIN, GERENTE, FINANCEIRO e VISUALIZADOR veem relatórios", () => {
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
