import {
  planInventoryAdjustments,
  type CountItem,
} from "@/server/modules/estoque/inventory-rules";

// Fase 9 — Inventário (regra crítica do AGENTS.md):
// "contagem 8 vs sistema 10 → ajuste 2". Regras puras, sem banco.

function item(partial: Partial<CountItem> & { productId: string }): CountItem {
  return {
    systemQty: 10,
    countedQty: null,
    ...partial,
  };
}

describe("planInventoryAdjustments", () => {
  it("contagem 8 vs sistema 10 → ajuste de saída 2", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: 8 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.pending).toBe(0);
    expect(plan.adjustments).toHaveLength(1);
    expect(plan.adjustments[0]).toEqual({
      productId: "p1",
      batchNumber: null,
      difference: -2,
      quantity: 2,
      direction: "SAIDA",
    });
  });

  it("contagem 12 vs sistema 10 → ajuste de entrada 2", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: 12 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments).toEqual([
      {
        productId: "p1",
        batchNumber: null,
        difference: 2,
        quantity: 2,
        direction: "ENTRADA",
      },
    ]);
  });

  it("contagem igual ao sistema → nenhum ajuste", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: 10 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments).toHaveLength(0);
    expect(plan.changed).toBe(0);
    expect(plan.pending).toBe(0);
  });

  it("item sem contagem fica pendente e não gera ajuste", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: null }),
      item({ productId: "p2", countedQty: undefined }),
      item({ productId: "p3", countedQty: 10 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.pending).toBe(2);
    expect(plan.adjustments).toHaveLength(0);
  });

  it("contagem decimal: 9,5 vs sistema 10 → saída 0,5", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", systemQty: 10, countedQty: 9.5 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments[0]).toMatchObject({
      direction: "SAIDA",
      quantity: 0.5,
      difference: -0.5,
    });
  });

  it("contagem negativa é recusada", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: -1 }),
    ]);

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("negativa");
  });

  it("saldo do sistema negativo é recusado (dado corrompido)", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", systemQty: -5, countedQty: 0 }),
    ]);

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("saldo do sistema");
  });

  it("contagem não numérica é recusada", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: Number.NaN }),
    ]);

    expect(plan.ok).toBe(false);
  });

  it("produto duplicado sem lote é recusado", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: 5 }),
      item({ productId: "p1", countedQty: 6 }),
    ]);

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("duplicado");
  });

  it("mesmo produto em lotes diferentes não é duplicado", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", batchNumber: "L1", countedQty: 5 }),
      item({ productId: "p1", batchNumber: "L2", countedQty: 6 }),
      item({ productId: "p1", batchNumber: null, countedQty: 3 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments).toHaveLength(3);
  });

  it("ajuste de produto com lote carrega o número do lote", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", batchNumber: "L1", systemQty: 4, countedQty: 2 }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments[0]).toMatchObject({
      batchNumber: "L1",
      direction: "SAIDA",
      quantity: 2,
    });
  });

  it("mistura ganhos e perdas em um único plano", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", systemQty: 10, countedQty: 8 }),
      item({ productId: "p2", systemQty: 3, countedQty: 5 }),
      item({ productId: "p3", systemQty: 7, countedQty: 7 }),
      item({ productId: "p4", systemQty: 7, countedQty: null }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(2);
    expect(plan.pending).toBe(1);
    expect(plan.adjustments.map((a) => a.direction)).toEqual([
      "SAIDA",
      "ENTRADA",
    ]);
  });

  it("inventário vazio é válido e não gera ajuste", () => {
    const plan = planInventoryAdjustments([]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.adjustments).toHaveLength(0);
    expect(plan.pending).toBe(0);
  });

  it("itens pendentes bloqueiam a aplicação", () => {
    const plan = planInventoryAdjustments([
      item({ productId: "p1", countedQty: 9 }),
      item({ productId: "p2", countedQty: null }),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const podeAplicar = plan.pending === 0;
    expect(podeAplicar).toBe(false);
  });
});
