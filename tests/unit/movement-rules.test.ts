import {
  calcAvgCostCents,
  isEntrada,
  isSaida,
  movementSignal,
  validateMovement,
} from "@/server/modules/estoque/movement-rules";

describe("classificação de tipos de movimentação", () => {
  it("todas as ENTRADAS sinalizam +1", () => {
    const entradas = [
      "ENTRADA_COMPRA",
      "ENTRADA_DEVOLUCAO",
      "ENTRADA_AJUSTE",
      "TRANSFERENCIA_ENTRADA",
    ];
    for (const t of entradas) {
      expect(isEntrada(t)).toBe(true);
      expect(isSaida(t)).toBe(false);
      expect(movementSignal(t)).toBe(1);
    }
  });

  it("todas as SAÍDAS sinalizam -1", () => {
    const saidas = [
      "SAIDA_VENDA",
      "SAIDA_DEVOLUCAO_FORNECEDOR",
      "SAIDA_PERDA",
      "SAIDA_QUEBRA",
      "SAIDA_VENCIMENTO",
      "SAIDA_AJUSTE",
      "TRANSFERENCIA_SAIDA",
    ];
    for (const t of saidas) {
      expect(isSaida(t)).toBe(true);
      expect(isEntrada(t)).toBe(false);
      expect(movementSignal(t)).toBe(-1);
    }
  });

  it("tipo desconhecido não é entrada nem saída", () => {
    expect(isEntrada("QUALQUER_COISA")).toBe(false);
    expect(isSaida("QUALQUER_COISA")).toBe(false);
    expect(() => movementSignal("QUALQUER_COISA")).toThrow();
  });
});

describe("validateMovement", () => {
  const base = {
    type: "ENTRADA_COMPRA",
    quantity: 10,
    unitCostCents: 1000,
    trackBatch: false,
    batchNumber: undefined as string | undefined,
  };

  it("aceita entrada válida", () => {
    expect(validateMovement(base)).toEqual({ ok: true });
  });

  it("rejeita quantidade zero/negativa", () => {
    expect(validateMovement({ ...base, quantity: 0 })).toMatchObject({
      ok: false,
    });
    expect(validateMovement({ ...base, quantity: -5 })).toMatchObject({
      ok: false,
    });
  });

  it("entrada exige custo >= 0", () => {
    expect(
      validateMovement({ ...base, unitCostCents: undefined }),
    ).toMatchObject({ ok: false });
    expect(
      validateMovement({ ...base, type: "ENTRADA_AJUSTE", unitCostCents: -1 }),
    ).toMatchObject({ ok: false });
  });

  it("saída não usa custo informado", () => {
    expect(
      validateMovement({ ...base, type: "SAIDA_PERDA", quantity: 3 }),
    ).toEqual({ ok: true });
  });

  it("produto que controla lote exige número do lote", () => {
    expect(
      validateMovement({ ...base, trackBatch: true, batchNumber: undefined }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("lote") });
    expect(
      validateMovement({ ...base, trackBatch: true, batchNumber: "L001" }),
    ).toEqual({ ok: true });
  });

  it("tipo desconhecido é recusado", () => {
    expect(validateMovement({ ...base, type: "FOO" })).toMatchObject({
      ok: false,
    });
  });
});

describe("custo médio móvel (calcAvgCostCents)", () => {
  it("10@R$10 + 10@R$12 → R$11 (regra crítica)", () => {
    expect(calcAvgCostCents(10, 1000, 10, 1200)).toBe(1100);
  });

  it("primeira entrada define o custo", () => {
    expect(calcAvgCostCents(0, 0, 7, 999)).toBe(999);
  });

  it("arredonda para o centavo mais próximo", () => {
    // (1*1 + 1*2)/2 = 1.5 → 150
    expect(calcAvgCostCents(1, 100, 1, 200)).toBe(150);
    // (10*1000 + 1*1200)/11 = 1018,18... → 1018
    expect(calcAvgCostCents(10, 1000, 1, 1200)).toBe(1018);
  });

  it("quantidade decimal (peso) entra na média", () => {
    // 1,5kg@R$10 + 0,5kg@R$20 → (15+10)/2 = R$12,50
    expect(calcAvgCostCents(1.5, 1000, 0.5, 2000)).toBe(1250);
  });
});
