import {
  assertTransition,
  calcSaleTotals,
  formatSaleNumber,
  validateSaleEditing,
  validateSaleDiscount,
} from "@/server/modules/vendas/sales-rules";

// Fase 10 — Vendas (regras críticas do AGENTS.md):
// máquina de estados DRAFT → CONFIRMED → BILLED, limite de desconto por papel,
// imutabilidade pós-BILLED. Regras puras, sem banco.

describe("assertTransition", () => {
  it("DRAFT → CONFIRMED é permitido", () => {
    expect(assertTransition("DRAFT", "CONFIRMED").ok).toBe(true);
  });

  it("CONFIRMED → BILLED é permitido", () => {
    expect(assertTransition("CONFIRMED", "BILLED").ok).toBe(true);
  });

  it("DRAFT → BILLED é recusado (pula a confirmação)", () => {
    const r = assertTransition("DRAFT", "BILLED");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("DRAFT");
  });

  it("CONFIRMED → DRAFT é recusado (sem voltar para rascunho)", () => {
    expect(assertTransition("CONFIRMED", "DRAFT").ok).toBe(false);
  });

  it("BILLED → CONFIRMED é recusado (imutável após faturar)", () => {
    const r = assertTransition("BILLED", "CONFIRMED");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("faturada");
  });

  it("CANCELLED é estado final — nenhuma transição sai dele", () => {
    expect(assertTransition("CANCELLED", "DRAFT").ok).toBe(false);
    expect(assertTransition("CANCELLED", "CONFIRMED").ok).toBe(false);
    expect(assertTransition("CANCELLED", "BILLED").ok).toBe(false);
  });

  it("CONFIRMED → CANCELLED é permitido (libera reserva)", () => {
    expect(assertTransition("CONFIRMED", "CANCELLED").ok).toBe(true);
  });

  it("DRAFT → CANCELLED é permitido", () => {
    expect(assertTransition("DRAFT", "CANCELLED").ok).toBe(true);
  });

  it("BILLED → BILLED é recusado (sem re-faturar)", () => {
    expect(assertTransition("BILLED", "BILLED").ok).toBe(false);
  });

  it("status desconhecido é recusado", () => {
    expect(assertTransition("QUALQUER", "DRAFT" as never).ok).toBe(false);
  });
});

describe("validateSaleEditing", () => {
  it("DRAFT é editável", () => {
    expect(validateSaleEditing("DRAFT").ok).toBe(true);
  });

  it("CONFIRMED não é editável (só cancelar/faturar)", () => {
    expect(validateSaleEditing("CONFIRMED").ok).toBe(false);
  });

  it("BILLED não é editável (correção é devolução/estorno)", () => {
    const r = validateSaleEditing("BILLED");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("devolução");
  });
});

describe("calcSaleTotals", () => {
  const item = (over: Partial<Parameters<typeof calcSaleTotals>[0][number]> = {}) => ({
    productId: "p1",
    quantity: 1,
    unitPriceCents: 1000,
    discountCents: 0,
    ...over,
  });

  it("soma o subtotal a partir de quantidade x preço unitário", () => {
    const r = calcSaleTotals([item({ quantity: 3, unitPriceCents: 1050 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totals).toEqual({
      subtotalCents: 3150,
      itemDiscountCents: 0,
      orderDiscountCents: 0,
      totalCents: 3150,
    });
  });

  it("descontos de item e de pedido baixam do total", () => {
    const r = calcSaleTotals(
      [
        item({ quantity: 2, unitPriceCents: 1000, discountCents: 100 }),
        item({ quantity: 1, unitPriceCents: 500 }),
      ],
      { orderDiscountCents: 250 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totals).toEqual({
      subtotalCents: 2500,
      itemDiscountCents: 100,
      orderDiscountCents: 250,
      totalCents: 2150,
    });
  });

  it("pedido sem itens é recusado", () => {
    const r = calcSaleTotals([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("item");
  });

  it("quantidade zero ou negativa é recusada", () => {
    expect(calcSaleTotals([item({ quantity: 0 })]).ok).toBe(false);
    expect(calcSaleTotals([item({ quantity: -2 })]).ok).toBe(false);
  });

  it("preço unitário negativo é recusado", () => {
    expect(calcSaleTotals([item({ unitPriceCents: -1 })]).ok).toBe(false);
  });

  it("desconto de item maior que a própria linha é recusado", () => {
    const r = calcSaleTotals([
      item({ quantity: 1, unitPriceCents: 1000, discountCents: 1200 }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("item");
  });

  it("desconto de pedido maior que o disponível é recusado", () => {
    const r = calcSaleTotals([item({ quantity: 1, unitPriceCents: 1000 })], {
      orderDiscountCents: 1001,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("pedido");
  });

  it("desconto de pedido igual ao total disponível é aceito (total zero)", () => {
    const r = calcSaleTotals([item({ quantity: 1, unitPriceCents: 1000 })], {
      orderDiscountCents: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totals.totalCents).toBe(0);
  });

  it("quantidade fracionária: 2,5 @ R$10,00 → 2500", () => {
    const r = calcSaleTotals([item({ quantity: 2.5, unitPriceCents: 1000 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totals.subtotalCents).toBe(2500);
  });

  it("valores não finitos são recusados", () => {
    expect(calcSaleTotals([item({ quantity: Number.NaN })]).ok).toBe(false);
    expect(
      calcSaleTotals([item({ unitPriceCents: Number.POSITIVE_INFINITY })]).ok,
    ).toBe(false);
  });
});

describe("validateSaleDiscount", () => {
  const base = {
    subtotalCents: 10000,
    itemDiscountCents: 0,
    orderDiscountCents: 0,
    maxDescontoVendedorPct: 5,
    maxDescontoGerentePct: 10,
  };

  it("VENDEDOR sem desconto passa mesmo com limite 0", () => {
    expect(
      validateSaleDiscount({ ...base, role: "VENDEDOR", salesDiscount: true }).ok,
    ).toBe(true);
  });

  it("VENDEDOR com 5% de desconto no limite de 5% é aceito", () => {
    const r = validateSaleDiscount({
      ...base,
      role: "VENDEDOR",
      salesDiscount: true,
      orderDiscountCents: 500,
      maxDescontoVendedorPct: 5,
    });
    expect(r.ok).toBe(true);
  });

  it("VENDEDOR acima do limite é recusado", () => {
    const r = validateSaleDiscount({
      ...base,
      role: "VENDEDOR",
      salesDiscount: true,
      orderDiscountCents: 501,
      maxDescontoVendedorPct: 5,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("5");
  });

  it("GERENTE usa o limite de gerente (10%)", () => {
    expect(
      validateSaleDiscount({
        ...base,
        role: "GERENTE",
        salesDiscount: true,
        orderDiscountCents: 1000,
      }).ok,
    ).toBe(true);
    expect(
      validateSaleDiscount({
        ...base,
        role: "GERENTE",
        salesDiscount: true,
        orderDiscountCents: 1001,
      }).ok,
    ).toBe(false);
  });

  it("ADMIN não tem teto de desconto", () => {
    expect(
      validateSaleDiscount({
        ...base,
        role: "ADMIN",
        salesDiscount: true,
        orderDiscountCents: 9000,
      }).ok,
    ).toBe(true);
  });

  it("papel sem permissão sales.discount não pode dar desconto", () => {
    const r = validateSaleDiscount({
      ...base,
      role: "ESTOQUISTA",
      salesDiscount: false,
      orderDiscountCents: 100,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("permissão");
  });

  it("desconto de item conta para o limite do papel", () => {
    const r = validateSaleDiscount({
      ...base,
      role: "VENDEDOR",
      salesDiscount: true,
      itemDiscountCents: 400,
      orderDiscountCents: 200,
      maxDescontoVendedorPct: 5,
    });
    expect(r.ok).toBe(false);
  });

  it("papel desconhecido não tem limite (só a permissão decide)", () => {
    expect(
      validateSaleDiscount({
        ...base,
        role: "QUALQUER",
        salesDiscount: true,
        orderDiscountCents: 9999,
      }).ok,
    ).toBe(true);
  });
});

describe("formatSaleNumber", () => {
  it("formata com 6 dígitos", () => {
    expect(formatSaleNumber(1)).toBe("VENDA-000001");
    expect(formatSaleNumber(123)).toBe("VENDA-000123");
  });

  it("número não inteiro é recusado", () => {
    expect(formatSaleNumber(1.5)).toBe("VENDA-000001");
  });
});
