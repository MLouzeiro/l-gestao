import {
  assertUnitHierarchy,
  expandMemberAccess,
  selectDefaultWarehouse,
  validateUnitTarget,
  UnitError,
  type UnitNode,
} from "@/server/modules/unidades/warehouse-rules";

const nodes = (
  list: { id: string; parentId: string | null; type?: string }[],
): UnitNode[] =>
  list.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    type: (n.type ?? "FILIAL") as UnitNode["type"],
  }));

describe("assertUnitHierarchy", () => {
  it("MATRIZ não pode ter unidade pai", () => {
    expect(() =>
      assertUnitHierarchy({
        parentId: "a",
        type: "MATRIZ",
        nodes: nodes([{ id: "a", parentId: null, type: "MATRIZ" }]),
      }),
    ).toThrow(UnitError);
    expect(() =>
      assertUnitHierarchy({
        parentId: "a",
        type: "MATRIZ",
        nodes: nodes([{ id: "a", parentId: null, type: "MATRIZ" }]),
      }),
    ).toThrow("matriz");
  });

  it("POSTO não pode ter unidades filhas", () => {
    expect(() =>
      assertUnitHierarchy({
        parentId: "posto",
        type: "FILIAL",
        nodes: nodes([
          { id: "matriz", parentId: null, type: "MATRIZ" },
          { id: "posto", parentId: "matriz", type: "POSTO" },
        ]),
      }),
    ).toThrow("POSTO");
  });

  it("unidade não pode ser pai de si mesma", () => {
    expect(() =>
      assertUnitHierarchy({
        selfId: "x",
        parentId: "x",
        type: "FILIAL",
        nodes: nodes([{ id: "x", parentId: null, type: "FILIAL" }]),
      }),
    ).toThrow("si mesma");
  });

  it("rejeita ciclo na hierarquia (pai é descendente da unidade)", () => {
    const tree = nodes([
      { id: "avó", parentId: null, type: "MATRIZ" },
      { id: "mãe", parentId: "avó", type: "FILIAL" },
      { id: "filha", parentId: "mãe", type: "FILIAL" },
    ]);
    expect(() =>
      assertUnitHierarchy({
        selfId: "mãe",
        parentId: "filha",
        type: "FILIAL",
        nodes: tree,
      }),
    ).toThrow("ciclo");
  });

  it("rejeita pai inexistente", () => {
    expect(() =>
      assertUnitHierarchy({
        parentId: "fantasma",
        type: "FILIAL",
        nodes: nodes([{ id: "a", parentId: null, type: "MATRIZ" }]),
      }),
    ).toThrow("não encontrada");
  });

  it("aceita FILIAL sob MATRIZ e POSTO sob FILIAL", () => {
    const tree = nodes([
      { id: "matriz", parentId: null, type: "MATRIZ" },
      { id: "filial", parentId: "matriz", type: "FILIAL" },
    ]);
    expect(() =>
      assertUnitHierarchy({ parentId: "matriz", type: "FILIAL", nodes: tree }),
    ).not.toThrow();
    expect(() =>
      assertUnitHierarchy({ parentId: "filial", type: "POSTO", nodes: tree }),
    ).not.toThrow();
    expect(() =>
      assertUnitHierarchy({ parentId: null, type: "POSTO", nodes: tree }),
    ).not.toThrow();
  });
});

describe("validateUnitTarget", () => {
  it("aceita alvo com campos vazios e faixa coerente", () => {
    expect(() =>
      validateUnitTarget({ minQty: null, maxQty: null, reorderPoint: null }),
    ).not.toThrow();
    expect(() =>
      validateUnitTarget({ minQty: 5, maxQty: 20, reorderPoint: 10 }),
    ).not.toThrow();
    expect(() =>
      validateUnitTarget({ minQty: 0, maxQty: 0, reorderPoint: 0 }),
    ).not.toThrow();
  });

  it("rejeita valores negativos", () => {
    expect(() =>
      validateUnitTarget({ minQty: -1, maxQty: null, reorderPoint: null }),
    ).toThrow("negativ");
  });

  it("rejeita mínimo maior que máximo", () => {
    expect(() =>
      validateUnitTarget({ minQty: 30, maxQty: 20, reorderPoint: null }),
    ).toThrow("mínimo");
  });

  it("rejeita ponto de reposição acima do máximo", () => {
    expect(() =>
      validateUnitTarget({ minQty: 5, maxQty: 20, reorderPoint: 25 }),
    ).toThrow("reposição");
  });
});

describe("expandMemberAccess", () => {
  const tree = nodes([
    { id: "matriz", parentId: null, type: "MATRIZ" },
    { id: "filial-sp", parentId: "matriz", type: "FILIAL" },
    { id: "filial-rj", parentId: "matriz", type: "FILIAL" },
    { id: "posto-campinas", parentId: "filial-sp", type: "POSTO" },
    { id: "posto-santos", parentId: "filial-sp", type: "POSTO" },
  ]);

  it("sem vínculos = acesso a todas as unidades (default amplo)", () => {
    expect(expandMemberAccess(tree, [])).toHaveLength(5);
  });

  it("com vínculos = acesso às próprias + herança dos descendentes", () => {
    const acesso = expandMemberAccess(tree, ["filial-sp"]);
    expect(acesso.sort()).toEqual(
      ["filial-sp", "posto-campinas", "posto-santos"].sort(),
    );
  });

  it("herança é recursiva (filial alcança netos) e não vaza irmãos", () => {
    const acesso = expandMemberAccess(tree, ["matriz"]);
    expect(acesso).toHaveLength(5);
    const soSp = expandMemberAccess(tree, ["posto-santos"]);
    expect(soSp).toEqual(["posto-santos"]);
  });

  it("consolida múltiplos vínculos e ignora id desconhecido", () => {
    const acesso = expandMemberAccess(tree, [
      "posto-campinas",
      "filial-rj",
      "desconhecida",
    ]);
    expect(acesso.sort()).toEqual(["filial-rj", "posto-campinas"].sort());
  });
});

describe("selectDefaultWarehouse", () => {
  it("prefere a unidade marcada como default", () => {
    const id = selectDefaultWarehouse([
      { id: "a", isDefault: false, code: "AAA" },
      { id: "b", isDefault: true, code: "ZZZ" },
    ]);
    expect(id).toBe("b");
  });

  it("sem default, escolhe determinístico pela menor ordem de código", () => {
    const id = selectDefaultWarehouse([
      { id: "a", isDefault: false, code: "ZZZ" },
      { id: "b", isDefault: false, code: "AAA" },
    ]);
    expect(id).toBe("b");
  });

  it("lista vazia retorna null", () => {
    expect(selectDefaultWarehouse([])).toBeNull();
  });
});
