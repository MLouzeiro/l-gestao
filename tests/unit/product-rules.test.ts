import {
  calcMarginPercent,
  hasParentCycle,
  hasKitCycle,
  normalizeSku,
  normalizeDocument,
  validateDocument,
  validateKitComponents,
  validateProductInput,
  validateVariation,
} from "@/server/modules/cadastros/product-rules";

describe("normalizeDocument", () => {
  it("mantém só os dígitos", () => {
    expect(normalizeDocument("123.456.789-01")).toBe("12345678901");
  });
});

describe("validateDocument", () => {
  it("documento vazio é opcional (ok)", () => {
    expect(validateDocument(null)).toEqual({ ok: true });
    expect(validateDocument("")).toEqual({ ok: true });
    expect(validateDocument("  ")).toEqual({ ok: true });
  });

  it("aceita CPF (11) e CNPJ (14)", () => {
    expect(validateDocument("12345678901")).toEqual({ ok: true });
    expect(validateDocument("12.345.678/0001-95")).toEqual({ ok: true });
  });

  it("rejeita tamanhos diferentes de 11/14", () => {
    expect(validateDocument("12345").ok).toBe(false);
    expect(validateDocument("1234567890123").ok).toBe(false); // 13 dígitos
  });
});

describe("normalizeSku", () => {
  it("remove espaços e coloca em maiúsculas", () => {
    expect(normalizeSku("  sku-001 ")).toBe("SKU-001");
  });
});

describe("validateProductInput", () => {
  const valido = {
    sku: "SKU-001",
    name: "Café 500g",
    salePriceCents: 1890,
    costPriceCents: 1000,
    minStock: 5,
    maxStock: 100,
    barcode: "7891234567895",
  };

  it("aceita entrada válida", () => {
    expect(validateProductInput(valido)).toEqual({ ok: true });
  });

  it("normaliza o SKU antes de validar", () => {
    expect(
      validateProductInput({ ...valido, sku: "  abc-1 " }),
    ).toEqual({ ok: true });
  });

  it("rejeita SKU curto", () => {
    const r = validateProductInput({ ...valido, sku: "A" });
    expect(r.ok).toBe(false);
  });

  it("rejeita SKU com caractere inválido", () => {
    const r = validateProductInput({ ...valido, sku: "SKU @ 1" });
    expect(r.ok).toBe(false);
  });

  it("rejeita nome curto", () => {
    const r = validateProductInput({ ...valido, name: "A" });
    expect(r.ok).toBe(false);
  });

  it("rejeita preço de venda negativo ou não inteiro", () => {
    expect(validateProductInput({ ...valido, salePriceCents: -1 }).ok).toBe(false);
    expect(validateProductInput({ ...valido, salePriceCents: 10.5 }).ok).toBe(false);
  });

  it("rejeita custo negativo", () => {
    expect(
      validateProductInput({ ...valido, costPriceCents: -100 }).ok,
    ).toBe(false);
  });

  it("rejeita estoque mínimo negativo", () => {
    expect(validateProductInput({ ...valido, minStock: -1 }).ok).toBe(false);
  });

  it("rejeita máximo menor que o mínimo", () => {
    expect(
      validateProductInput({ ...valido, minStock: 10, maxStock: 5 }).ok,
    ).toBe(false);
  });

  it("rejeita código de barras com menos de 8 ou mais de 14 dígitos", () => {
    expect(validateProductInput({ ...valido, barcode: "1234567" }).ok).toBe(false);
    expect(validateProductInput({ ...valido, barcode: "123456789012345" }).ok).toBe(false);
    expect(validateProductInput({ ...valido, barcode: "12345678" }).ok).toBe(true);
  });

  it("aceita produto sem código de barras", () => {
    expect(
      validateProductInput({ ...valido, barcode: null }).ok,
    ).toBe(true);
  });
});

describe("calcMarginPercent", () => {
  it("margem 10 → 15 = 50%", () => {
    expect(calcMarginPercent(1000, 1500)).toBe(50);
  });

 it("custo zero não gera margem (nulo, como a coluna gerada)", () => {
    expect(calcMarginPercent(0, 1500)).toBeNull();
  });

  it("arredonda para 2 casas", () => {
    expect(calcMarginPercent(1000, 1333)).toBe(33.3);
  });

  it("margem negativa quando venda < custo", () => {
    expect(calcMarginPercent(2000, 1500)).toBe(-25);
  });
});

describe("validateKitComponents", () => {
  const kitId = "kit-1";

  it("aceita lista válida", () => {
    expect(
      validateKitComponents(kitId, [
        { componentId: "a", quantity: 2 },
        { componentId: "b", quantity: 1 },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejeita lista vazia", () => {
    const r = validateKitComponents(kitId, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ao menos 1 componente/i);
  });

  it("rejeita quantidade <= 0 ou não finita", () => {
    expect(
      validateKitComponents(kitId, [{ componentId: "a", quantity: 0 }]).ok,
    ).toBe(false);
    expect(
      validateKitComponents(kitId, [{ componentId: "a", quantity: -2 }]).ok,
    ).toBe(false);
    expect(
      validateKit(kitId, [{ componentId: "a", quantity: Number.NaN }]).ok,
    ).toBe(false);
  });

  it("rejeita auto-referência (kit compondo a si mesmo)", () => {
    const r = validateKitComponents(kitId, [{ componentId: kitId, quantity: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/si mesmo/i);
  });

  it("rejeita componentes duplicados", () => {
    const r = validateKitComponents(kitId, [
      { componentId: "a", quantity: 1 },
      { componentId: "a", quantity: 2 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/duplicado/i);
  });
});

// helper para manter os testes acima legíveis
function validateKit(
  kitId: string,
  components: { componentId: string; quantity: number }[],
) {
  return validateKitComponents(kitId, components);
}

describe("hasKitCycle", () => {
  it("sem arestas → sem ciclo", () => {
    expect(hasKitCycle([])).toBe(false);
  });

  it("árvore simples → sem ciclo", () => {
    expect(
      hasKitCycle([
        { kitId: "A", componentId: "B" },
        { kitId: "A", componentId: "C" },
        { kitId: "B", componentId: "D" },
      ]),
    ).toBe(false);
  });

  it("A → B → A é ciclo", () => {
    expect(
      hasKitCycle([
        { kitId: "A", componentId: "B" },
        { kitId: "B", componentId: "A" },
      ]),
    ).toBe(true);
  });

  it("ciclo longo A → B → C → A é ciclo", () => {
    expect(
      hasKitCycle([
        { kitId: "A", componentId: "B" },
        { kitId: "B", componentId: "C" },
        { kitId: "C", componentId: "A" },
      ]),
    ).toBe(true);
  });

  it("auto-loop é ciclo", () => {
    expect(hasKitCycle([{ kitId: "A", componentId: "A" }])).toBe(true);
  });
});

describe("validateVariation", () => {
  it("sem pai é produto comum (ok)", () => {
    expect(validateVariation("p1", null, false)).toEqual({ ok: true });
  });

  it("não pode ser pai de si mesmo", () => {
    const r = validateVariation("p1", "p1", false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/si mesmo/i);
  });

  it("kit não pode ser variação de outro produto", () => {
    const r = validateVariation("p1", "p2", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/kit/i);
  });
});

describe("hasParentCycle", () => {
  const parents = new Map<string, string | null>([
    ["A", "B"],
    ["B", null],
  ]);

  it("apontar para produto sem ciclo → false", () => {
    expect(hasParentCycle(parents, "C", "B")).toBe(false);
  });

  it("apontar para si mesmo → true", () => {
    expect(hasParentCycle(parents, "B", "B")).toBe(true);
  });

  it("criar ciclo na cadeia → true (B passa a ter pai A)", () => {
    expect(hasParentCycle(parents, "B", "A")).toBe(true);
  });

  it("sem pai → false", () => {
    expect(hasParentCycle(parents, "C", null)).toBe(false);
  });
});
