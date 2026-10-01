import { resolveProductByCode } from "@/lib/sale-scan";

const produtos = [
  {
    id: "p1",
    sku: "CAFE-001",
    name: "Café Torrado 500g",
    barcode: "7891234567890",
    salePriceCents: 1990,
  },
  {
    id: "p2",
    sku: "7891111111111",
    name: "Leite Condensado",
    barcode: null,
    salePriceCents: 450,
  },
  {
    id: "p3",
    sku: "ACUCAR-1KG",
    name: "Açúcar Refinado 1kg",
    barcode: " 7891111111111 ",
    salePriceCents: 399,
  },
];

describe("resolveProductByCode", () => {
  it("entrada vazia ou só espaços retorna null", () => {
    expect(resolveProductByCode(produtos, "")).toBeNull();
    expect(resolveProductByCode(produtos, "   ")).toBeNull();
  });

  it("acha pelo código de barras exato", () => {
    const r = resolveProductByCode(produtos, "7891234567890");
    expect(r?.status).toBe("found");
    if (r?.status === "found") expect(r.product.id).toBe("p1");
  });

  it("ignora espaços do scanner/cadastro (trim nos dois lados)", () => {
    const r = resolveProductByCode(produtos, " 7891111111111 ");
    expect(r?.status).toBe("found");
    if (r?.status === "found") expect(r.product.id).toBe("p3");
  });

  it("barcode tem prioridade sobre SKU de outro produto", () => {
    // "7891111111111" é o barcode do p3 E o SKU do p2 — barcode ganha.
    const r = resolveProductByCode(produtos, "7891111111111");
    expect(r?.status).toBe("found");
    if (r?.status === "found") expect(r.product.id).toBe("p3");
  });

  it("cai para SKU quando o código não é barcode (case-insensitive)", () => {
    const r = resolveProductByCode(produtos, " cafe-001 ");
    expect(r?.status).toBe("found");
    if (r?.status === "found") expect(r.product.id).toBe("p1");
  });

  it("produto sem barcode não casa por igualdade nula", () => {
    const r = resolveProductByCode(produtos, "null");
    expect(r).toEqual({ status: "not_found", code: "null" });
  });

  it("código desconhecido retorna not_found com o código normalizado", () => {
    expect(resolveProductByCode(produtos, " 000000000 ")).toEqual({
      status: "not_found",
      code: "000000000",
    });
  });
});
