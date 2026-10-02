import { and, eq } from "drizzle-orm";
import {
  financialAccounts,
  financialPayments,
} from "@/server/db/schema";
import {
  registerPayment,
  markAccountsOverdue,
} from "@/server/modules/financeiro/financial.service";
import { FinancialError, asUtcDay } from "@/server/modules/financeiro/financial-rules";
import { SaleError, billSale, confirmSale, createSale } from "@/server/modules/vendas/sales.service";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 11 (M4) → críticos do AGENTS.md:
// venda faturada gera conta a receber; baixa parcial; paid_amount <= amount;
// vencida vira OVERDUE; RLS A != B; VENDEDOR 403.

function ctxFor(tenantId: string) {
  return { tenantId, userId: null, role: "ADMIN", salesDiscount: true };
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

async function getAccounts(tenantId: string, sourceId?: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(financialAccounts)
      .where(
        sourceId
          ? and(
              eq(financialAccounts.tenantId, tenantId),
              eq(financialAccounts.sourceId, sourceId),
            )
          : eq(financialAccounts.tenantId, tenantId),
      )
      .orderBy(financialAccounts.installmentNumber);
    return rows;
  });
}

function dayOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** dia local de "agora" (o banco guarda o dia local em UTC midnight) */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

describe("financeiro → venda faturada gera parcelas a receber", () => {
  it("fatura 3x →  3 contas RECEIVABLE com soma igual ao total e vencimentos mensais", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await faturar(tenantId, warehouseId, productId, {
      installments: 3,
      quantity: 3,
      unitPriceCents: 2000, // total R$ 60,00
    });

    const accounts = await getAccounts(tenantId, saleId);
    expect(accounts).toHaveLength(3);
    expect(accounts.map((a) => a.installmentNumber)).toEqual([1, 2, 3]);
    expect(accounts.every((a) => a.direction === "RECEIVABLE")).toBe(true);
    expect(accounts.every((a) => a.source === "SALE")).toBe(true);
    expect(accounts.every((a) => a.status === "OPEN")).toBe(true);
    expect(accounts.every((a) => a.installmentCount === 3)).toBe(true);

    const soma = accounts.reduce((s, a) => s + Math.round(parseFloat(a.amount) * 100), 0);
    expect(soma).toBe(6000);

    const hoje = todayLocal();
    expect(dayOf(accounts[0]!.dueDate)).toBe(hoje);
    // parcelas 2+ caem em mês seguinte (clamp coberto no unit)
    expect(accounts[1]!.dueDate.getTime()).toBeGreaterThan(accounts[0]!.dueDate.getTime());
    expect(dayOf(accounts[1]!.dueDate)).not.toBe(hoje);
    expect(accounts[0]!.description).toMatch(/^VENDA-\d{6}$/);
  });

  it("à vista (1x) →  exatamente 1 conta com o total", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await faturar(tenantId, warehouseId, productId, {
      installments: 1,
      quantity: 2,
      unitPriceCents: 1500,
    });

    const accounts = await getAccounts(tenantId, saleId);
    expect(accounts).toHaveLength(1);
    expect(Math.round(parseFloat(accounts[0]!.amount) * 100)).toBe(3000);
    expect(accounts[0]!.paidAmount).toBe("0.00");
  });

  it("recusa parcelas fora de 1..12 na criação da venda", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        createSale(tx, ctxFor(tenantId), {
          warehouseId,
          installments: 13,
          items: [{ productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      ),
    ).rejects.toThrow(SaleError);

    await expect(
      withTenant(tenantId, (tx) =>
        createSale(tx, ctxFor(tenantId), {
          warehouseId,
          installments: 0,
          items: [{ productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      ),
    ).rejects.toThrow(SaleError);
  });
});

describe("financeiro → baixa (pagamento parcial e total)", () => {
  it("baixa parcial vira PARTIAL e a quitação vira PAID com paidAt", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await faturar(tenantId, warehouseId, productId, {
      quantity: 1,
      unitPriceCents: 5000,
    });
    const [account] = await getAccounts(tenantId, saleId);

    const r1 = await withTenant(tenantId, (tx) =>
      registerPayment(tx, ctxFor(tenantId), account!.id, {
        amountCents: 2000,
        paymentMethod: "PIX",
      }),
    );
    expect(r1.status).toBe("PARTIAL");
    expect(r1.paidCents).toBe(2000);

    const r2 = await withTenant(tenantId, (tx) =>
      registerPayment(tx, ctxFor(tenantId), account!.id, {
        amountCents: 3000,
        paymentMethod: "Dinheiro",
        interestCents: 0,
        discountCents: 0,
      }),
    );
    expect(r2.status).toBe("PAID");
    expect(r2.paidCents).toBe(5000);

    const depois = await getAccounts(tenantId, saleId);
    expect(depois[0]!.paidAmount).toBe("50.00");
    expect(depois[0]!.status).toBe("PAID");
    expect(depois[0]!.paidAt).not.toBeNull();

    const pagamentos = await withTenant(tenantId, async (tx) =>
      tx
        .select()
        .from(financialPayments)
        .where(eq(financialPayments.financialAccountId, account!.id)),
    );
    expect(pagamentos).toHaveLength(2);
  });

  it("baixa maior que o saldo é recusada e nada é gravado", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await faturar(tenantId, warehouseId, productId, {
      quantity: 1,
      unitPriceCents: 5000,
    });
    const [account] = await getAccounts(tenantId, saleId);

    await expect(
      withTenant(tenantId, (tx) =>
        registerPayment(tx, ctxFor(tenantId), account!.id, {
          amountCents: 5001,
          paymentMethod: "PIX",
        }),
      ),
    ).rejects.toThrow(FinancialError);

    await expect(
      withTenant(tenantId, (tx) =>
        registerPayment(tx, ctxFor(tenantId), account!.id, {
          amountCents: 0,
          paymentMethod: "PIX",
        }),
      ),
    ).rejects.toThrow(FinancialError);

    const depois = await getAccounts(tenantId, saleId);
    expect(depois[0]!.paidAmount).toBe("0.00");
    expect(depois[0]!.status).toBe("OPEN");
  });
});

describe("financeiro → OVERDUE por vencimento", () => {
  it("conta vencida OPEN vira OVERDUE no markAccountsOverdue; futura não muda", async () => {
    const { tenantId } = await createTestTenant();

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const futuro = new Date();
    futuro.setDate(futuro.getDate() + 10);

    await withTenant(tenantId, async (tx) => {
      await tx.insert(financialAccounts).values([
        {
          tenantId,
          direction: "RECEIVABLE",
          source: "MANUAL",
          description: "Vencida ontem",
          dueDate: asUtcDay(ontem),
          amount: "100.00",
          status: "OPEN",
        },
        {
          tenantId,
          direction: "RECEIVABLE",
          source: "MANUAL",
          description: "Vence depois",
          dueDate: asUtcDay(futuro),
          amount: "100.00",
          status: "OPEN",
        },
      ]);
    });

    const marcadas = await withTenant(tenantId, (tx) =>
      markAccountsOverdue(tx, tenantId),
    );
    expect(marcadas).toBe(1);

    const accounts = await getAccounts(tenantId);
    const vencida = accounts.find((a) => a.description === "Vencida ontem");
    const futura = accounts.find((a) => a.description === "Vence depois");
    expect(vencida?.status).toBe("OVERDUE");
    expect(futura?.status).toBe("OPEN");

    // quitação da OVERDUE →  PAID
    if (vencida) {
      const r = await withTenant(tenantId, (tx) =>
        registerPayment(tx, ctxFor(tenantId), vencida.id, {
          amountCents: 10000,
          paymentMethod: "Transferência",
        }),
      );
      expect(r.status).toBe("PAID");
    }
  });
});

describe("financeiro → RLS e imutabilidade", () => {
  it("conta da Empresa A é invisível para a Empresa B (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);
    await addStock(a.tenantId, a.warehouseId, productId, 10);

    const saleId = await faturar(a.tenantId, a.warehouseId, productId, {
      quantity: 1,
      unitPriceCents: 3000,
    });

    const emB = await withTenant(b.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.tenantId, a.tenantId));
      return rows.length;
    });
    expect(emB).toBe(0);

    // baixa da B não acha a conta da A →  erro, e nada muda
    const [contaA] = await getAccounts(a.tenantId, saleId);
    await expect(
      withTenant(b.tenantId, (tx) =>
        registerPayment(tx, ctxFor(b.tenantId), contaA!.id, {
          amountCents: 100,
          paymentMethod: "PIX",
        }),
      ),
    ).rejects.toThrow(/não encontrada/i);
    const intacta = await getAccounts(a.tenantId, saleId);
    expect(intacta[0]!.paidAmount).toBe("0.00");
  });

  it("financial_payments é imutável (UPDATE/DELETE afetam 0 linhas)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await faturar(tenantId, warehouseId, productId, {
      quantity: 1,
      unitPriceCents: 4000,
    });
    const [account] = await getAccounts(tenantId, saleId);
    await withTenant(tenantId, (tx) =>
      registerPayment(tx, ctxFor(tenantId), account!.id, {
        amountCents: 1000,
        paymentMethod: "PIX",
      }),
    );

    const resultado = await withTenant(tenantId, async (tx) => {
      const upd = await tx
        .update(financialPayments)
        .set({ amount: "999.00" })
        .where(eq(financialPayments.financialAccountId, account!.id))
        .returning({ id: financialPayments.id });
      const del = await tx
        .delete(financialPayments)
        .where(eq(financialPayments.financialAccountId, account!.id))
        .returning({ id: financialPayments.id });
      return { upd: upd.length, del: del.length };
    });
    expect(resultado.upd).toBe(0);
    expect(resultado.del).toBe(0);
  });
});

describe("financeiro → RBAC (403 no servidor)", () => {
  it("VENDEDOR/VISUALIZADOR sem finance.* recebem 403; FINANCEIRO/ADMIN passam", () => {
    expect(() => assertPermission("VENDEDOR", "finance.payments")).toThrow(PermissionError);
    expect(() => assertPermission("VISUALIZADOR", "finance.manage")).toThrow(PermissionError);
    expect(() => assertPermission("VENDEDOR", "finance.view")).toThrow(PermissionError);

    expect(() => assertPermission("FINANCEIRO", "finance.payments")).not.toThrow();
    expect(() => assertPermission("FINANCEIRO", "finance.manage")).not.toThrow();
    expect(() => assertPermission("ADMIN", "finance.payments")).not.toThrow();
    expect(() => assertPermission("VISUALIZADOR", "finance.view")).not.toThrow();

    try {
      assertPermission("VENDEDOR", "finance.payments");
      throw new Error("devia ter lançado PermissionError");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).status).toBe(403);
    }
  });
});
