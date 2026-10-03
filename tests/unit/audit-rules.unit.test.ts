import {
  auditActionForMovement,
  auditActionLabel,
  auditDiff,
  sanitizeSnapshot,
} from "@/server/modules/auditoria/audit-rules";

describe("sanitizeSnapshot", () => {
  it("remove chaves sensíveis no nível raiz", () => {
    const out = sanitizeSnapshot({
      id: "1",
      name: "Ana",
      password: "x",
      token: "abc",
    }) as Record<string, unknown>;
    expect(out).toEqual({ id: "1", name: "Ana" });
  });

  it("remove chaves sensíveis em objetos aninhados (case-insensitive)", () => {
    const out = sanitizeSnapshot({
      user: { email: "a@b.c", passwordHash: "h", totpSecret: "s" },
      accounts: [{ provider: "credential", accessToken: "t" }],
    }) as { user: Record<string, unknown>; accounts: unknown[] };
    expect(out.user).toEqual({ email: "a@b.c" });
    expect(out.accounts).toEqual([{ provider: "credential" }]);
  });

  it("não muta o objeto original", () => {
    const original = { name: "Ana", password: "x" };
    sanitizeSnapshot(original);
    expect(original).toEqual({ name: "Ana", password: "x" });
  });

  it("mantém primitivos, null e datas", () => {
    expect(sanitizeSnapshot("texto")).toBe("texto");
    expect(sanitizeSnapshot(42)).toBe(42);
    expect(sanitizeSnapshot(null)).toBeNull();
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(sanitizeSnapshot(date)).toEqual(date);
  });
});

describe("auditDiff", () => {
  it("retorna apenas as chaves que mudaram", () => {
    const out = auditDiff(
      { name: "Ana", stock: 10 },
      { name: "Ana", stock: 7 },
    );
    expect(out).toEqual({ before: { stock: 10 }, after: { stock: 7 } });
  });

  it("retorna objetos vazios quando nada mudou", () => {
    expect(auditDiff({ a: 1, b: "x" }, { b: "x", a: 1 })).toEqual({
      before: {},
      after: {},
    });
  });

  it("trata chave adicionada como before: null", () => {
    const out = auditDiff({}, { note: "novo" });
    expect(out).toEqual({ before: { note: null }, after: { note: "novo" } });
  });

  it("trata chave removida como after: null", () => {
    const out = auditDiff({ note: "antigo" }, {});
    expect(out).toEqual({ before: { note: "antigo" }, after: { note: null } });
  });

  it("compara objetos aninhados por valor (não por ordem de chaves)", () => {
    const out = auditDiff(
      { item: { a: 1, b: 2 } },
      { item: { b: 2, a: 1 } },
    );
    expect(out).toEqual({ before: {}, after: {} });
  });

  it("remove chaves sensíveis do diff", () => {
    const out = auditDiff(
      { name: "Ana", password: "old" },
      { name: "Ana", password: "new" },
    );
    expect(out).toEqual({ before: {}, after: {} });
  });
});

describe("auditActionForMovement", () => {
  it("mapeia tipos de entrada", () => {
    expect(auditActionForMovement("ENTRADA_COMPRA")).toBe("ENTRADA_ESTOQUE");
    expect(auditActionForMovement("ENTRADA_DEVOLUCAO")).toBe("ENTRADA_ESTOQUE");
  });

  it("mapeia tipos de saída", () => {
    expect(auditActionForMovement("SAIDA_VENDA")).toBe("SAIDA_ESTOQUE");
    expect(auditActionForMovement("SAIDA_PERDA")).toBe("SAIDA_ESTOQUE");
  });

  it("mapeia transferência nos dois sentidos", () => {
    expect(auditActionForMovement("TRANSFERENCIA_ENTRADA")).toBe(
      "TRANSFERENCIA",
    );
    expect(auditActionForMovement("TRANSFERENCIA_SAIDA")).toBe(
      "TRANSFERENCIA",
    );
  });

  it("mapeia ajustes", () => {
    expect(auditActionForMovement("ENTRADA_AJUSTE")).toBe("AJUSTE_ESTOQUE");
    expect(auditActionForMovement("SAIDA_AJUSTE")).toBe("AJUSTE_ESTOQUE");
  });

  it("tipo desconhecido vira MOVIMENTO_ESTOQUE", () => {
    expect(auditActionForMovement("QUALQUER")).toBe("MOVIMENTO_ESTOQUE");
  });
});

describe("auditActionLabel", () => {
  it("converte ação conhecida para pt-BR", () => {
    expect(auditActionLabel("CRIACAO_VENDA")).toBe("Criação de venda");
    expect(auditActionLabel("ENTRADA_ESTOQUE")).toBe("Entrada de estoque");
  });

  it("ação desconhecida volta o próprio código", () => {
    expect(auditActionLabel("ACAO_QUALQUER")).toBe("ACAO_QUALQUER");
  });
});
