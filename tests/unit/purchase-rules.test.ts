import {
  PURCHASE_NUMBER_PREFIX,
  assertPurchaseTransition,
  calcPurchaseTotalCents,
  formatPurchaseNumber,
  parseEntryDate,
  validatePurchaseInstallments,
  validatePurchaseItems,
  type PurchaseItemInput,
} from "@/server/modules/compras/purchase-rules";

// Regras puras do módulo de compras (Fase 11 / M4) — TDD.

function item(over: Partial<PurchaseItemInput> = {}): PurchaseItemInput {
  return {
    productId: "11111111-1111-1111-1111-111111111111",
    quantity: 10,
    unitCostCents: 1000,
    ...over,
  };
}

describe("assertPurchaseTransition", () => {
  it("OPEN → CONFIRMED é permitido", () => {
    expect(assertPurchaseTransition("OPEN", "CONFIRMED").ok).toBe(true);
  });

  it("OPEN → CANCELLED é permitido (rascunho descartado)", () => {
    expect(assertPurchaseTransition("OPEN", "CANCELLED").ok).toBe(true);
  });

  it("OPEN → OPEN é rejeitado", () => {
    const r = assertPurchaseTransition("OPEN", "OPEN");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/inválida/i);
  });

  it("CONFIRMED → CONFIRMED é rejeitado (já confirmada)", () => {
    const r = assertPurchaseTransition("CONFIRMED", "CONFIRMED");
    expect(r.ok).toBe(false);
  });

  it("CONFIRMED → CANCELLED é rejeitado até haver estorno (v1)", () => {
    const r = assertPurchaseTransition("CONFIRMED", "CANCELLED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/estorno|futura/i);
  });

  it("CANCELLED não transiciona para nada", () => {
    expect(assertPurchaseTransition("CANCELLED", "CONFIRMED").ok).toBe(false);
    expect(assertPurchaseTransition("CANCELLED", "CANCELLED").ok).toBe(false);
  });
});

describe("validatePurchaseItems", () => {
  it("lista vazia é rejeitada", () => {
    const r = validatePurchaseItems([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/item/i);
  });

  it("quantidade zero é rejeitada", () => {
    const r = validatePurchaseItems([item({ quantity: 0 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/quantidade/i);
  });

  it("quantidade negativa é rejeitada", () => {
    expect(validatePurchaseItems([item({ quantity: -1 })]).ok).toBe(false);
  });

  it("custo unitário negativo é rejeitado", () => {
    const r = validatePurchaseItems([item({ unitCostCents: -1 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/custo/i);
  });

  it("mais de 500 itens é rejeitado", () => {
    const many = Array.from({ length: 501 }, (_, i) =>
      item({ productId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` }),
    );
    const r = validatePurchaseItems(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/500/);
  });

  it("produto duplicado no MESMO lote é rejeitado", () => {
    const r = validatePurchaseItems([
      item({ batchNumber: "L1" }),
      item({ batchNumber: "L1" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/duplicado/i);
  });

  it("mesmo produto em lotes diferentes é permitido", () => {
    const r = validatePurchaseItems([
      item({ batchNumber: "L1" }),
      item({ batchNumber: "L2" }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("produto sem lote duplicado é rejeitado", () => {
    expect(validatePurchaseItems([item(), item()]).ok).toBe(false);
  });

  it("validade com formato inválido é rejeitada", () => {
    const r = validatePurchaseItems([item({ expiresAt: "01/10/2026" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/validade/i);
  });

  it("lista válida passa", () => {
    const r = validatePurchaseItems([
      item(),
      item({
        productId: "22222222-2222-2222-2222-222222222222",
        quantity: 2.5,
        unitCostCents: 1050,
        batchNumber: "L9",
        expiresAt: "2027-06-30",
      }),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("calcPurchaseTotalCents", () => {
  it("10 un @ R$10,00 = R$100,00 (10000 centavos)", () => {
    expect(calcPurchaseTotalCents([item({ quantity: 10, unitCostCents: 1000 })])).toBe(10000);
  });

  it("2,5 un @ R$10,50 = R$26,25 (2625 centavos)", () => {
    expect(calcPurchaseTotalCents([item({ quantity: 2.5, unitCostCents: 1050 })])).toBe(2625);
  });

  it("soma linha a linha com arredondamento por item", () => {
    const total = calcPurchaseTotalCents([
      item({ quantity: 3, unitCostCents: 333 }),
      item({ quantity: 1, unitCostCents: 100 }),
    ]);
    // 3 * 333 / 1000 = 0,999 → 1 centavo? não: 3un * R$3,33 = R$9,99 → 999
    expect(total).toBe(999 + 100);
  });

  it("lista vazia soma zero", () => {
    expect(calcPurchaseTotalCents([])).toBe(0);
  });
});

describe("validatePurchaseInstallments", () => {
  it("aceita 1 e 12", () => {
    expect(validatePurchaseInstallments(1).ok).toBe(true);
    expect(validatePurchaseInstallments(12).ok).toBe(true);
  });

  it("rejeita 0, 13 e não-inteiro", () => {
    expect(validatePurchaseInstallments(0).ok).toBe(false);
    expect(validatePurchaseInstallments(13).ok).toBe(false);
    expect(validatePurchaseInstallments(1.5).ok).toBe(false);
  });
});

describe("parseEntryDate", () => {
  it("converte YYYY-MM-DD para UTC midnight do dia", () => {
    const d = parseEntryDate("2026-10-01");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rejeita formato brasileiro e datas impossíveis", () => {
    expect(parseEntryDate("01/10/2026")).toBeNull();
    expect(parseEntryDate("2026-13-01")).toBeNull();
    expect(parseEntryDate("2026-02-30")).toBeNull();
    expect(parseEntryDate("")).toBeNull();
  });
});

describe("formatPurchaseNumber", () => {
  it("formata COMPRA-000001", () => {
    expect(PURCHASE_NUMBER_PREFIX).toBe("COMPRA");
    expect(formatPurchaseNumber(1)).toBe("COMPRA-000001");
    expect(formatPurchaseNumber(42)).toBe("COMPRA-000042");
  });
});
