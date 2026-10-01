import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  customers,
  members,
  salesOrderItems,
  salesOrders,
  stockBalances,
  stockMovements,
  stockReservations,
  tenantSettings,
  users,
} from "@/server/db/schema";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { formatSaleNumber } from "@/server/modules/vendas/sales-rules";
import {
  SaleError,
  billSale,
  cancelSale,
  confirmSale,
  createSale,
  deleteSale,
  getSaleDetail,
  listSales,
  updateSale,
  type SaleContext,
} from "@/server/modules/vendas/sales.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Críticos do AGENTS.md (M3): reserva na confirmação, baixa no faturamento,
// liberação no cancelamento, imutabilidade pós-BILLED e 403 de RBAC.

function ctxFor(
  tenantId: string,
  overrides: Partial<SaleContext> = {},
): SaleContext {
  return {
    tenantId,
    userId: null,
    role: "ADMIN",
    salesDiscount: true,
    ...overrides,
  };
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

async function getSale(tenantId: string, saleId: string) {
  return withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .select({
        status: salesOrders.status,
        number: salesOrders.number,
        total: salesOrders.total,
      })
      .from(salesOrders)
      .where(
        and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)),
      );
    return s ?? null;
  });
}

async function countMovements(tenantId: string, type?: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ t: stockMovements.type })
      .from(stockMovements)
      .where(eq(stockMovements.tenantId, tenantId));
    return type ? rows.filter((r) => r.t === type).length : rows.length;
  });
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

async function draftSale(
  tenantId: string,
  warehouseId: string,
  productId: string,
  quantity: number,
  overrides: Partial<Parameters<typeof createSale>[2]> = {},
): Promise<string> {
  const { saleId } = await withTenant(tenantId, (tx) =>
    createSale(tx, ctxFor(tenantId), {
      warehouseId,
      items: [{ productId, quantity, unitPriceCents: 2000 }],
      ...overrides,
    }),
  );
  return saleId;
}

describe("vendas — reserva na confirmação (regra crítica)", () => {
  it("reserva 20 de 100 → disponível 80; cancelar → reservado 0", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 100);

    const saleId = await draftSale(tenantId, warehouseId, productId, 20);
    await withTenant(tenantId, (tx) => confirmSale(tx, ctxFor(tenantId), saleId));

    let bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(100);
    expect(Number(bal?.reserved)).toBe(20);

    // disponível = 80 → saída de 81 é recusada
    await expect(
      withTenant(tenantId, (tx) =>
        applyMovement(tx, {
          tenantId,
          type: "SAIDA_AJUSTE",
          productId,
          warehouseId,
          quantity: 81,
        }),
      ),
    ).rejects.toThrow(/insuficiente/i);

    await withTenant(tenantId, (tx) => cancelSale(tx, ctxFor(tenantId), saleId));

    bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(100);
    expect(Number(bal?.reserved)).toBe(0);

    const [reserva] = await withTenant(tenantId, async (tx) =>
      tx
        .select({ status: stockReservations.status })
        .from(stockReservations)
        .where(eq(stockReservations.referenceId, saleId)),
    );
    expect(reserva?.status).toBe("RELEASED");
    expect((await getSale(tenantId, saleId))?.status).toBe("CANCELLED");
  });

  it("cancelar rascunho também encerra (sem reserva ativa)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await draftSale(tenantId, warehouseId, productId, 5);
    await withTenant(tenantId, (tx) => cancelSale(tx, ctxFor(tenantId), saleId));

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.reserved)).toBe(0);
    expect((await getSale(tenantId, saleId))?.status).toBe("CANCELLED");
  });

  it("recusa confirmação sem saldo disponível", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 5);

    const saleId = await draftSale(tenantId, warehouseId, productId, 6);
    await expect(
      withTenant(tenantId, (tx) => confirmSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/saldo insuficiente/i);
    expect((await getSale(tenantId, saleId))?.status).toBe("DRAFT");
  });
});

describe("vendas — faturamento baixa o estoque (regra crítica)", () => {
  it("fatura: baixa saldo, gera SAIDA_VENDA e libera a reserva", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await draftSale(tenantId, warehouseId, productId, 3);
    await withTenant(tenantId, (tx) => confirmSale(tx, ctxFor(tenantId), saleId));
    await withTenant(tenantId, (tx) => billSale(tx, ctxFor(tenantId), saleId));

    const bal = await getBalance(tenantId, productId);
    expect(Number(bal?.quantity)).toBe(7);
    expect(Number(bal?.reserved)).toBe(0);

    expect(await countMovements(tenantId, "SAIDA_VENDA")).toBe(1);
    const [mov] = await withTenant(tenantId, async (tx) =>
      tx
        .select({
          referenceId: stockMovements.referenceId,
          referenceType: stockMovements.referenceType,
          quantity: stockMovements.quantity,
        })
        .from(stockMovements)
        .where(eq(stockMovements.type, "SAIDA_VENDA")),
    );
    expect(mov?.referenceId).toBe(saleId);
    expect(mov?.referenceType).toBe("SALE");
    expect(Number(mov?.quantity)).toBe(3);

    expect((await getSale(tenantId, saleId))?.status).toBe("BILLED");

    // imutável após faturar
    await expect(
      withTenant(tenantId, (tx) => cancelSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/faturada/i);
    await expect(
      withTenant(tenantId, (tx) => confirmSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/faturada/i);
    expect((await getSale(tenantId, saleId))?.status).toBe("BILLED");
  });

  it("rascunho não pode ser faturado (pula a confirmação)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const saleId = await draftSale(tenantId, warehouseId, productId, 2);
    await expect(
      withTenant(tenantId, (tx) => billSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/DRAFT/);
    expect(await countMovements(tenantId, "SAIDA_VENDA")).toBe(0);
  });

  it("sem reserva ativa: fatura checando o saldo e falha sem mudar status", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    // reservaEstoque desligada → confirmar não reserva nada (commit antes)
    await withTenant(tenantId, (tx) =>
      tx
        .update(tenantSettings)
        .set({ reservaEstoque: false })
        .where(eq(tenantSettings.tenantId, tenantId)),
    );

    await withTenant(tenantId, async (tx) => {
      const { saleId } = await createSale(tx, ctxFor(tenantId), {
        warehouseId,
        items: [{ productId, quantity: 6, unitPriceCents: 2000 }],
      });
      await confirmSale(tx, ctxFor(tenantId), saleId);

      const [bal] = await tx
        .select()
        .from(stockBalances)
        .where(eq(stockBalances.productId, productId));
      expect(Number(bal.reserved)).toBe(0);

      // outro processo consome o estoque
      await applyMovement(tx, {
        tenantId,
        type: "SAIDA_AJUSTE",
        productId,
        warehouseId,
        quantity: 8,
      });

      await expect(billSale(tx, ctxFor(tenantId), saleId)).rejects.toThrow(
        /faturamento recusado/i,
      );

      const [still] = await tx
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, saleId));
      expect(still.status).toBe("CONFIRMED");
    });
  });
});

describe("vendas — numeração e desconto no servidor", () => {
  it("numera por empresa, sem duplicar entre empresas", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId: pa } = await createTestProduct(a.tenantId);
    const { productId: pb } = await createTestProduct(b.tenantId);

    const n1 = await withTenant(a.tenantId, async (tx) =>
      createSale(tx, ctxFor(a.tenantId), {
        warehouseId: a.warehouseId,
        items: [{ productId: pa, quantity: 1, unitPriceCents: 1000 }],
      }),
    );
    const n2 = await withTenant(a.tenantId, async (tx) =>
      createSale(tx, ctxFor(a.tenantId), {
        warehouseId: a.warehouseId,
        items: [{ productId: pa, quantity: 1, unitPriceCents: 1000 }],
      }),
    );
    const nb = await withTenant(b.tenantId, async (tx) =>
      createSale(tx, ctxFor(b.tenantId), {
        warehouseId: b.warehouseId,
        items: [{ productId: pb, quantity: 1, unitPriceCents: 1000 }],
      }),
    );

    expect(n1.number).toBe(1);
    expect(n2.number).toBe(2);
    expect(nb.number).toBe(1);
    expect(n1.saleId).not.toBe(n2.saleId);
  });

  it("recusa desconto acima do teto do papel (servidor)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        createSale(
          tx,
          ctxFor(tenantId, { role: "VENDEDOR", salesDiscount: true }),
          {
            warehouseId,
            items: [{ productId, quantity: 1, unitPriceCents: 10000 }],
            orderDiscountCents: 501, // teto padrão do tenant é 0%
          },
        ),
      ),
    ).rejects.toThrow(SaleError);
  });

  it("recusa produto de outra empresa", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(b.tenantId);

    await expect(
      withTenant(a.tenantId, (tx) =>
        createSale(tx, ctxFor(a.tenantId), {
          warehouseId: a.warehouseId,
          items: [{ productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      ),
    ).rejects.toThrow(/produto não encontrado/i);
  });
});

describe("vendas — edição e exclusão do rascunho", () => {
  it("edita itens/totais/notas do DRAFT e depois exclui o pedido inteiro", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 50);

    const criada = await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        items: [{ productId, quantity: 2, unitPriceCents: 1000 }],
      }),
    );
    expect(criada.totals.totalCents).toBe(2000);

    const editada = await withTenant(tenantId, (tx) =>
      updateSale(tx, ctxFor(tenantId), criada.saleId, {
        warehouseId,
        notes: "nota editada no teste",
        items: [{ productId, quantity: 3, unitPriceCents: 1500 }],
      }),
    );
    expect(editada.totals.totalCents).toBe(4500);

    const detalhe = await withTenant(tenantId, (tx) =>
      getSaleDetail(tx, tenantId, criada.saleId),
    );
    expect(detalhe?.status).toBe("DRAFT");
    expect(detalhe?.notes).toBe("nota editada no teste");
    expect(detalhe?.totalCents).toBe(4500);
    expect(detalhe?.items).toHaveLength(1);
    expect(detalhe?.items[0]?.quantity).toBe(3);
    expect(detalhe?.items[0]?.lineTotalCents).toBe(4500);

    await withTenant(tenantId, (tx) =>
      deleteSale(tx, ctxFor(tenantId), criada.saleId),
    );
    const depois = await withTenant(tenantId, (tx) =>
      getSaleDetail(tx, tenantId, criada.saleId),
    );
    expect(depois).toBeNull();
  });

  it("não edita nem exclui fora do DRAFT (CONFIRMED e BILLED)", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);

    const { saleId } = await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        items: [{ productId, quantity: 1, unitPriceCents: 1000 }],
      }),
    );
    await withTenant(tenantId, (tx) => confirmSale(tx, ctxFor(tenantId), saleId));

    await expect(
      withTenant(tenantId, (tx) =>
        updateSale(tx, ctxFor(tenantId), saleId, {
          warehouseId,
          items: [{ productId, quantity: 2, unitPriceCents: 1000 }],
        }),
      ),
    ).rejects.toThrow(/confirmada não é editável/i);

    await expect(
      withTenant(tenantId, (tx) => deleteSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/confirmada não é editável/i);

    await withTenant(tenantId, (tx) => billSale(tx, ctxFor(tenantId), saleId));

    await expect(
      withTenant(tenantId, (tx) => deleteSale(tx, ctxFor(tenantId), saleId)),
    ).rejects.toThrow(/faturada não é editável/i);
  });
});

describe("vendas — RLS", () => {
  it("venda da Empresa A é invisível para a Empresa B (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();
    const { productId } = await createTestProduct(a.tenantId);

    const saleId = await draftSale(a.tenantId, a.warehouseId, productId, 1);

    const emB = await withTenant(b.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.tenantId, a.tenantId));
      const itens = await tx
        .select()
        .from(salesOrderItems)
        .where(eq(salesOrderItems.tenantId, a.tenantId));
      return { vendas: rows.length, itens: itens.length };
    });
    expect(emB.vendas).toBe(0);
    expect(emB.itens).toBe(0);

    // e a Empresa B não consegue alterar a venda da Empresa A
    await expect(
      withTenant(b.tenantId, (tx) => confirmSale(tx, ctxFor(b.tenantId), saleId)),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe("vendas — RBAC (403 no servidor)", () => {
  it("papel sem a permissão é recusado com status 403", () => {
    expect(() => assertPermission("VISUALIZADOR", "sales.manage")).toThrow(
      PermissionError,
    );
    expect(() => assertPermission("VENDEDOR", "sales.billing")).toThrow(
      PermissionError,
    );

    try {
      assertPermission("VISUALIZADOR", "sales.manage");
      throw new Error("devia ter lançado PermissionError");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).status).toBe(403);
    }
  });

  it("papel com a permissão passa", () => {
    expect(() => assertPermission("VENDEDOR", "sales.manage")).not.toThrow();
    expect(() => assertPermission("ADMIN", "sales.billing")).not.toThrow();
    expect(() => assertPermission("ESTOQUISTA", "sales.view")).not.toThrow();
  });
});

describe("vendas — leituras (listagem e detalhe da UI)", () => {
  async function criarCliente(tenantId: string, nome: string): Promise<string> {
    // customers tem RLS → inserir sempre com o contexto do tenant
    return withTenant(tenantId, async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ tenantId, name: nome })
        .returning({ id: customers.id });
      return c.id;
    });
  }

  async function criarVendedor(tenantId: string): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({
        name: "Vendedor Teste",
        email: `vendedor-${randomUUID().slice(0, 8)}@teste.com`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    await db.insert(members).values({
      organizationId: tenantId,
      userId: u.id,
      role: "VENDEDOR",
    });
    return u.id;
  }

  it("lista com filtro de status, busca e paginação", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 50);
    const customerId = await criarCliente(tenantId, "Mercado São João");

    const r1 = await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        customerId,
        items: [{ productId, quantity: 2, unitPriceCents: 2000 }],
      }),
    );
    await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        items: [{ productId, quantity: 1, unitPriceCents: 2000 }],
      }),
    );
    const r3 = await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        items: [{ productId, quantity: 3, unitPriceCents: 2000 }],
      }),
    );
    await withTenant(tenantId, (tx) =>
      confirmSale(tx, ctxFor(tenantId), r3.saleId),
    );

    const tudo = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { page: 1, pageSize: 2 }),
    );
    expect(tudo.total).toBe(3);
    expect(tudo.rows).toHaveLength(2);
    // mais recente primeiro (r3 confirmada)
    expect(tudo.rows[0]?.id).toBe(r3.saleId);
    expect(tudo.rows[0]?.status).toBe("CONFIRMED");

    const pagina2 = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { page: 2, pageSize: 2 }),
    );
    expect(pagina2.rows).toHaveLength(1);

    const rascunhos = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { status: "DRAFT", pageSize: 50 }),
    );
    expect(rascunhos.total).toBe(2);

    const busca = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { search: "São João", pageSize: 50 }),
    );
    expect(busca.total).toBe(1);
    expect(busca.rows[0]?.id).toBe(r1.saleId);
    expect(busca.rows[0]?.customerName).toBe("Mercado São João");

    const porNumero = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { search: String(r1.number), pageSize: 50 }),
    );
    expect(porNumero.total).toBe(1);

    const porNumeroFormatado = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, {
        search: formatSaleNumber(r1.number),
        pageSize: 50,
      }),
    );
    expect(porNumeroFormatado.total).toBe(1);
    expect(porNumeroFormatado.rows[0]?.id).toBe(r1.saleId);

    const porPrefixo = await withTenant(tenantId, (tx) =>
      listSales(tx, tenantId, { search: "venda-00000", pageSize: 50 }),
    );
    expect(porPrefixo.total).toBeGreaterThanOrEqual(1);
  });

  it("detalhe traz itens, totais, depósito e vendedor", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId, sku } = await createTestProduct(tenantId);
    await addStock(tenantId, warehouseId, productId, 10);
    const customerId = await criarCliente(tenantId, "Farmácia Central");
    const sellerId = await criarVendedor(tenantId);

    const { saleId } = await withTenant(tenantId, (tx) =>
      createSale(tx, ctxFor(tenantId), {
        warehouseId,
        customerId,
        sellerId,
        notes: "entrega à tarde",
        orderDiscountCents: 500,
        items: [{ productId, quantity: 3, unitPriceCents: 2000 }],
      }),
    );

    const detalhe = await withTenant(tenantId, (tx) =>
      getSaleDetail(tx, tenantId, saleId),
    );
    expect(detalhe).not.toBeNull();
    expect(detalhe?.status).toBe("DRAFT");
    expect(detalhe?.customerName).toBe("Farmácia Central");
    expect(detalhe?.warehouseName).toBe("Depósito Padrão");
    expect(detalhe?.sellerName).toBe("Vendedor Teste");
    expect(detalhe?.notes).toBe("entrega à tarde");
    expect(detalhe?.subtotalCents).toBe(6000);
    expect(detalhe?.orderDiscountCents).toBe(500);
    expect(detalhe?.totalCents).toBe(5500);
    expect(detalhe?.items).toHaveLength(1);
    expect(detalhe?.items[0]?.productName).toBe("Produto Teste");
    expect(detalhe?.items[0]?.sku).toBe(sku);
    expect(detalhe?.items[0]?.quantity).toBe(3);
    expect(detalhe?.items[0]?.lineTotalCents).toBe(6000);

    // outro tenant não enxerga
    const outro = await createTestTenant();
    const alheio = await withTenant(outro.tenantId, (tx) =>
      getSaleDetail(tx, outro.tenantId, saleId),
    );
    expect(alheio).toBeNull();
  });
});
