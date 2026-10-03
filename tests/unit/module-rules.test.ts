import {
  MODULE_CATALOG,
  moduleErrorMessage,
  resolveModuleKeys,
  segmentModulePreset,
} from "@/server/modules/tenancy/module-rules";

// Regras puras de módulos contratáveis (PROMPT MESTRE §35): preset por
// segmento, catálogo e mensagens — tests/unit/module-rules.test.ts.

describe("MODULE_CATALOG", () => {
  it("tem chaves estáveis em MAIÚSCULAS e únicas", () => {
    const keys = MODULE_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(keys).toContain("ESTOQUE");
    expect(keys).toContain("VENDAS");
    expect(keys).toContain("PDV");
    expect(keys).toContain("MATRIZ_POSTOS");
  });
});

describe("segmentModulePreset", () => {
  it("COMERCIO_GERAL: base sem módulos de laboratório", () => {
    const m = segmentModulePreset("COMERCIO_GERAL");
    expect(m).toContain("ESTOQUE");
    expect(m).toContain("VENDAS");
    expect(m).toContain("PDV");
    expect(m).toContain("FINANCEIRO");
    expect(m).not.toContain("MATRIZ_POSTOS");
    expect(m).not.toContain("REPOSICAO");
  });

  it("LABORATORIO e SAUDE: trilha completa matriz→postos", () => {
    for (const seg of ["LABORATORIO", "SAUDE"] as const) {
      const m = segmentModulePreset(seg);
      expect(m).toContain("MATRIZ_POSTOS");
      expect(m).toContain("TRANSFERENCIAS");
      expect(m).toContain("REPOSICAO");
      expect(m).toContain("LOTES_VALIDADE");
      expect(m).toContain("AUDITORIA");
    }
  });

  it("FARMACIA e FRIGORIFICO: lotes/validade; LANCHONETE: PDV", () => {
    expect(segmentModulePreset("FARMACIA")).toContain("LOTES_VALIDADE");
    expect(segmentModulePreset("FRIGORIFICO")).toContain("LOTES_VALIDADE");
    expect(segmentModulePreset("LANCHONETE")).toContain("PDV");
    expect(segmentModulePreset("OUTRO")).toContain("ESTOQUE");
  });

  it("todo preset referencia apenas chaves do catálogo", () => {
    const valid = new Set(MODULE_CATALOG.map((m) => m.key));
    for (const seg of [
      "COMERCIO_GERAL",
      "FARMACIA",
      "LABORATORIO",
      "SAUDE",
      "LANCHONETE",
      "FRIGORIFICO",
      "OUTRO",
    ] as const) {
      for (const k of segmentModulePreset(seg)) expect(valid.has(k)).toBe(true);
    }
  });
});

describe("resolveModuleKeys", () => {
  it("une o preset do plano com o do segmento e remove duplicados", () => {
    const keys = resolveModuleKeys({
      segment: "LABORATORIO",
      planModuleKeys: ["PDV", "ESTOQUE"],
    });
    expect(keys.filter((k) => k === "ESTOQUE")).toHaveLength(1);
    expect(keys).toContain("PDV");
    expect(keys).toContain("MATRIZ_POSTOS");
  });

  it("sem plano: usa só o preset do segmento", () => {
    const keys = resolveModuleKeys({ segment: "COMERCIO_GERAL" });
    expect(keys).toEqual(segmentModulePreset("COMERCIO_GERAL"));
  });
});

describe("moduleErrorMessage", () => {
  it("mensagem em pt-BR nomeando o módulo", () => {
    const msg = moduleErrorMessage("MATRIZ_POSTOS");
    expect(msg).toContain("MATRIZ_POSTOS");
    expect(msg.toLowerCase()).toContain("módulo");
  });
});
