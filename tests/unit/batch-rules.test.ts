import {
  batchLabelData,
  classifyExpiry,
  daysUntil,
  summarizeTrace,
  type TraceMovement,
} from "@/server/modules/lotes/batch-rules";

const HOJE = "2026-10-03";

describe("classifyExpiry", () => {
  it("sem validade = SEM_VALIDADE", () => {
    expect(classifyExpiry(null, [], HOJE)).toBe("SEM_VALIDADE");
  });

  it("vencido = VENCIDO (no dia ainda vale)", () => {
    expect(classifyExpiry("2026-10-02", [], HOJE)).toBe("VENCIDO");
    expect(classifyExpiry("2026-10-03", [], HOJE)).not.toBe("VENCIDO");
    expect(classifyExpiry("2026-10-03", [], HOJE)).toBe("OK");
  });

  it("janela de alerta: dias relativas ao hoje classificam CRITICO/PROXIMO", () => {
    // janelas 7 e 30: <= 7 dias = CRITICO; <= 30 = PROXIMO
    expect(classifyExpiry("2026-10-05", [7, 30], HOJE)).toBe("CRITICO");
    expect(classifyExpiry("2026-10-10", [7, 30], HOJE)).toBe("CRITICO");
    expect(classifyExpiry("2026-10-20", [7, 30], HOJE)).toBe("PROXIMO");
    expect(classifyExpiry("2026-11-01", [7, 30], HOJE)).toBe("PROXIMO");
    expect(classifyExpiry("2026-12-01", [7, 30], HOJE)).toBe("OK");
  });

  it("janela vazia: qualquer futuro é OK", () => {
    expect(classifyExpiry("2026-10-04", [], HOJE)).toBe("OK");
    expect(classifyExpiry("2027-01-01", [], HOJE)).toBe("OK");
  });

  it("janelas desordenadas e duplicadas funcionam (menor = mais crítico)", () => {
    expect(classifyExpiry("2026-10-05", [30, 7, 7], HOJE)).toBe("CRITICO");
    expect(classifyExpiry("2026-10-25", [30, 7], HOJE)).toBe("PROXIMO");
  });

  it("dias negativos/zero na janela são ignorados", () => {
    expect(classifyExpiry("2026-10-05", [-1, 0, 7], HOJE)).toBe("CRITICO");
    expect(classifyExpiry("2026-12-05", [-1, 0], HOJE)).toBe("OK");
  });
});

describe("daysUntil", () => {
  it("diferença em dias (inclusive negativa para vencido)", () => {
    expect(daysUntil("2026-10-13", HOJE)).toBe(10);
    expect(daysUntil("2026-10-03", HOJE)).toBe(0);
    expect(daysUntil("2026-09-28", HOJE)).toBe(-5);
    expect(daysUntil(null, HOJE)).toBeNull();
  });
});

describe("batchLabelData", () => {
  it("monta os dados da etiqueta (produto, lote, validade, código)", () => {
    const label = batchLabelData({
      productName: "Dipirona 500mg",
      sku: "DIP-500",
      barcode: "7891234567890",
      batchNumber: "L2026-01",
      expiresAt: "2027-06-30",
      quantity: 120,
    });
    expect(label.productName).toBe("Dipirona 500mg");
    expect(label.batchNumber).toBe("L2026-01");
    expect(label.expiresText).toBe("30/06/2027");
    expect(label.code).toBe("7891234567890");
    expect(label.quantityText).toBe("120");
  });

  it("sem barcode usa o SKU; sem validade mostra hífen; datas pt-BR", () => {
    const label = batchLabelData({
      productName: "Produto X",
      sku: "SKU-X",
      barcode: null,
      batchNumber: "L1",
      expiresAt: null,
      quantity: 1.5,
    });
    expect(label.code).toBe("SKU-X");
    expect(label.expiresText).toBe("—");
    expect(label.quantityText).toBe("1,5");
  });
});

describe("summarizeTrace", () => {
  const mov = (over: Partial<TraceMovement> = {}): TraceMovement => ({
    id: "m1",
    type: "ENTRADA_COMPRA",
    quantity: 10,
    occurredAt: "2026-10-01T10:00:00.000Z",
    warehouseName: "Matriz",
    userName: "Ana",
    saleId: null,
    saleNumber: null,
    customerName: null,
    ...over,
  });

  it("consolida entradas, saídas e clientes distintos", () => {
    const trace = [
      mov(),
      mov({ id: "m2", type: "SAIDA_VENDA", quantity: 3, saleId: "s1", saleNumber: 1, customerName: "Mercado São João" }),
      mov({ id: "m3", type: "SAIDA_VENDA", quantity: 2, saleId: "s2", saleNumber: 2, customerName: "Mercado São João" }),
      mov({ id: "m4", type: "SAIDA_VENDA", quantity: 1, saleId: "s3", saleNumber: 3, customerName: "Farmácia Vida" }),
    ];
    const s = summarizeTrace(trace);
    expect(s.entradas).toBe(10);
    expect(s.saidas).toBe(6);
    expect(s.saldo).toBe(4);
    expect(s.vendas).toBe(3);
    expect(s.clientes).toEqual(["Farmácia Vida", "Mercado São João"]);
  });

  it("lote sem movimentações zera tudo", () => {
    const s = summarizeTrace([]);
    expect(s).toEqual({
      entradas: 0,
      saidas: 0,
      saldo: 0,
      vendas: 0,
      clientes: [],
    });
  });
});
