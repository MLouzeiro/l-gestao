import { and, eq } from "drizzle-orm";
import {
  cashMovements,
  cashRegisters,
  financialAccounts,
  financialPayments,
  salesOrders,
  stockBalances,
} from "@/server/db/schema";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import {
  addSangria,
  addSupply,
  closeCash,
  getCashSummary,
  getOpenCash,
  openCash,
} from "@/server/modules/pdv/cash.service";
import { PdvError, checkoutPdv } from "@/server/modules/pdv/pdv.service";
import type { SaleContext } from "@/server/modules/vendas/sales.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Críticos do AGENTS.md (PDV): entrada 10 + saída 3 = saldo 7, venda faturada
// baixa estoque e gera conta a receber (já paga no à vista), caixa fechado
// recusa venda, RLS entre caixas de empresas diferentes.

function ctxFor(tenantId: string, overrides: Partial<SaleContext> = {}): SaleContext {
  return {
    tenantId,
    userId: null,
    role: "ADMIN",
    salesDiscount: true,
    ...overrides,
  };
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

describe("PDV — checkout à vista (regra crítica)", () => {
  it("estoque 10 vendido 3 = saldo 7; BILLED; conta PAID + pagamento + movimento de caixa", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 10000 }),
    );

    const result = await withTenant(tenantId, (tx) =>
      checkoutPdv(tx, ctxFor(tenantId), {
        warehouseId,
        paymentMethod: "DINHEIRO",
        receivedCents: 7000,
        items: [{ productId, quantity: 3, unitPriceCents: 2000 }],
      }),
    );

    expect(result.totalCents).toBe(6000);
    expect(result.trocoCents).toBe(1000);

    const balance = await getBalance(tenantId, productId);
    expect(Number(balance?.quantity)).toBe(7);

    const sale = await withTenant(tenantId, async (tx) => {
      const [s] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, result.saleId)),
        );
      return s;
    });
    expect(sale?.status).toBe("BILLED");
    expect(sale?.paymentMethod).toBe("DINHEIRO");
    expect(sale?.origin).toBe("PDV");

    const accounts = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.tenantId, tenantId)),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.status).toBe("PAID");
    expect(Number(accounts[0]?.paidAmount)).toBe(60);

    const payments = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(financialPayments)
        .where(eq(financialPayments.tenantId, tenantId)),
    );
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]?.amount)).toBe(60);

    const movements = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.tenantId, tenantId)),
    );
    const vendaMov = movements.find((m) => m.type === "VENDA");
    expect(vendaMov?.amount).toBe("60.00");
    expect(vendaMov?.paymentMethod).toBe("DINHEIRO");
    expect(vendaMov?.saleId).toBe(result.saleId);

    const summary = await withTenant(tenantId, (tx) => getCashSummary(tx, tenantId));
    expect(summary.salesCount).toBe(1);
    expect(summary.salesTotalCents).toBe(6000);
    // abertura 100 + venda 60 em dinheiro
    expect(summary.expected.cash).toBe(16000);
  });

  it("CREDITO 3x: 3 parcelas OPEN somando o total, sem baixa imediata", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 5);
    await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 0 }),
    );

    const result = await withTenant(tenantId, (tx) =>
      checkoutPdv(tx, ctxFor(tenantId), {
        warehouseId,
        paymentMethod: "CREDITO",
        installments: 3,
        items: [{ productId, quantity: 1, unitPriceCents: 3000 }],
      }),
    );
    expect(result.totalCents).toBe(3000);
    expect(result.accountIds).toHaveLength(3);

    const accounts = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.tenantId, tenantId)),
    );
    expect(accounts).toHaveLength(3);
    for (const a of accounts) expect(a.status).toBe("OPEN");
    const sum = accounts.reduce((acc, a) => acc + Number(a.amount), 0);
    expect(sum).toBe(30);
    expect(accounts.every((a) => Number(a.paidAmount) === 0)).toBe(true);
  });
});

describe("PDV — caixa", () => {
  it("sem caixa aberto: checkout é recusado (mensagem pt-BR)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 5);

    await expect(
      withTenant(tenantId, (tx) =>
        checkoutPdv(tx, ctxFor(tenantId), {
          warehouseId,
          paymentMethod: "PIX",
          items: [{ productId, quantity: 1, unitPriceCents: 2000 }],
        }),
      ),
    ).rejects.toThrow(/caixa/i);
  });

  it("já existe caixa aberto: abrir de novo é recusado", async () => {
    const { tenantId } = await createTestTenant();
    await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 1000 }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        openCash(tx, ctxFor(tenantId), { openingAmountCents: 1000 }),
      ),
    ).rejects.toThrow(/aberto/i);
  });

  it("sangria acima do saldo em caixa é recusada", async () => {
    const { tenantId } = await createTestTenant();
    await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 10000 }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        addSangria(tx, ctxFor(tenantId), { amountCents: 20000, description: "Teste" }),
      ),
    ).rejects.toThrow(/saldo|caixa/i);
  });

  it("fechamento: esperado = abertura + vendas + suprimentos − sangrias; diferença calculada", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const opened = await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 10000 }),
    );
    await withTenant(tenantId, (tx) =>
      checkoutPdv(tx, ctxFor(tenantId), {
        warehouseId,
        paymentMethod: "DINHEIRO",
        receivedCents: 6000,
        items: [{ productId, quantity: 3, unitPriceCents: 2000 }],
      }),
    );
    await withTenant(tenantId, (tx) =>
      addSupply(tx, ctxFor(tenantId), { amountCents: 2000, description: "Troco extra" }),
    );
    await withTenant(tenantId, (tx) =>
      addSangria(tx, ctxFor(tenantId), { amountCents: 1000, description: "Banco" }),
    );

    const closing = await withTenant(tenantId, (tx) =>
      closeCash(tx, ctxFor(tenantId), {
        countedCashCents: 16500,
        countedCardCents: 0,
        countedPixCents: 0,
        countedOtherCents: 0,
      }),
    );
    // esperado em dinheiro: 100 + 60 + 20 − 10 = 170; contado 165 → −5
    expect(closing.differenceCents).toBe(-500);

    const register = await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(cashRegisters)
        .where(
          and(
            eq(cashRegisters.tenantId, tenantId),
            eq(cashRegisters.id, opened.cashRegisterId),
          ),
        );
      return r;
    });
    expect(register?.status).toBe("CLOSED");
    expect(register?.expectedCash).toBe("170.00");
    expect(register?.difference).toBe("-5.00");

    const open = await withTenant(tenantId, (tx) => getOpenCash(tx, tenantId));
    expect(open).toBeNull();
  });

  it("suprimento e venda exigem caixa aberto", async () => {
    const { tenantId } = await createTestTenant();
    await expect(
      withTenant(tenantId, (tx) =>
        addSupply(tx, ctxFor(tenantId), { amountCents: 100 }),
      ),
    ).rejects.toThrow(/caixa/i);
    await expect(
      withTenant(tenantId, (tx) =>
        addSangria(tx, ctxFor(tenantId), { amountCents: 100 }),
      ),
    ).rejects.toThrow(/caixa/i);
  });
});

describe("PDV — RLS (checklist: Empresa A não vê dados de Empresa B)", () => {
  it("caixa aberto na Empresa A é invisível para a Empresa B (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const opened = await withTenant(a.tenantId, (tx) =>
      openCash(tx, ctxFor(a.tenantId), { openingAmountCents: 5000 }),
    );

    const seenByB = await withTenant(b.tenantId, (tx) =>
      tx.select().from(cashRegisters),
    );
    expect(seenByB).toHaveLength(0);

    const seenByA = await withTenant(a.tenantId, (tx) =>
      tx.select().from(cashRegisters),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]?.id).toBe(opened.cashRegisterId);

    const movementsSeenByB = await withTenant(b.tenantId, (tx) =>
      tx.select().from(cashMovements),
    );
    expect(movementsSeenByB).toHaveLength(0);
  });

  it("checkout na Empresa B não enxerga estoque nem caixa da Empresa A", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    await addStock(a.tenantId, a.warehouseId, (await createTestProduct(a.tenantId)).productId, 10);
    await withTenant(a.tenantId, (tx) =>
      openCash(tx, ctxFor(a.tenantId), { openingAmountCents: 1000 }),
    );
    const { productId } = await createTestProduct(b.tenantId);

    // Empresa B sem estoque e sem caixa → recusa por caixa (nunca vaza dados de A)
    await expect(
      withTenant(b.tenantId, (tx) =>
        checkoutPdv(tx, ctxFor(b.tenantId), {
          warehouseId: b.warehouseId,
          paymentMethod: "PIX",
          items: [{ productId, quantity: 1, unitPriceCents: 100 }],
        }),
      ),
    ).rejects.toThrow(PdvError);
  });
});

describe("PDV — estoque insuficiente", () => {
  it("vender além do disponível é recusado no servidor", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 2);
    await withTenant(tenantId, (tx) =>
      openCash(tx, ctxFor(tenantId), { openingAmountCents: 0 }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        checkoutPdv(tx, ctxFor(tenantId), {
          warehouseId,
          paymentMethod: "DEBITO",
          items: [{ productId, quantity: 5, unitPriceCents: 2000 }],
        }),
      ),
    ).rejects.toThrow(/dispon|insuficiente|estoque/i);
  });
});
