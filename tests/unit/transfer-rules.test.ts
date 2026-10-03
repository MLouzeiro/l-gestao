import {
  assertTransferItems,
  assertTransferTransition,
  calcTransferCostCents,
  formatTransferNumber,
  shouldReleaseOnSend,
  TransferError,
  type TransferAction,
} from "@/server/modules/transferencias/transfer-rules";

describe("assertTransferTransition", () => {
  it("DRAFT aceita enviar e cancelar", () => {
    expect(() =>
      assertTransferTransition("DRAFT", "send"),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition("DRAFT", "cancel"),
    ).not.toThrow();
  });

  it("SENT aceita receber e cancelar (com estorno se baixa no envio)", () => {
    expect(() =>
      assertTransferTransition("SENT", "receive"),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition("SENT", "cancel"),
    ).not.toThrow();
  });

  it("RECEIVED e CANCELLED são finais", () => {
    for (const action of ["send", "receive", "cancel"] as TransferAction[]) {
      expect(() =>
        assertTransferTransition("RECEIVED", action),
      ).toThrow(TransferError);
      expect(() =>
        assertTransferTransition("CANCELLED", action),
      ).toThrow(TransferError);
    }
  });

  it("DRAFT não aceita receber", () => {
    expect(() =>
      assertTransferTransition("DRAFT", "receive"),
    ).toThrow("enviada");
  });
});

describe("assertTransferItems", () => {
  const item = (productId: string, quantity: number) => ({ productId, quantity });

  it("aceita lista válida com um item por produto (lote opcional)", () => {
    expect(() =>
      assertTransferItems([
        { ...item("a", 2), batchNumber: "L1" },
        item("b", 1),
      ]),
    ).not.toThrow();
  });

  it("rejeita lista vazia, quantidade <= 0 e produto duplicado", () => {
    expect(() => assertTransferItems([])).toThrow("ao menos um item");
    expect(() => assertTransferItems([item("a", 0)])).toThrow("maior que zero");
    expect(() => assertTransferItems([item("a", -1)])).toThrow("maior que zero");
    expect(() =>
      assertTransferItems([item("a", 1), item("a", 2)]),
    ).toThrow("duplicado");
    expect(() =>
      assertTransferItems([
        { ...item("a", 1), batchNumber: "L1" },
        { ...item("a", 2), batchNumber: "L2" },
      ]),
    ).toThrow("duplicado");
  });

  it("rejeita mais de 200 itens", () => {
    const muitos = Array.from({ length: 201 }, (_, i) => item(`p${i}`, 1));
    expect(() => assertTransferItems(muitos)).toThrow("200");
  });
});

describe("regras de custo e baixa", () => {
  it("shouldReleaseOnSend: só quando a baixa é no envio", () => {
    expect(shouldReleaseOnSend("SEND")).toBe(true);
    expect(shouldReleaseOnSend("RECEIVE")).toBe(false);
  });

  it("calcTransferCostCents: 10 × R$12,50 = 12500 centavos", () => {
    expect(calcTransferCostCents(1250, 10)).toBe(12500);
    expect(calcTransferCostCents(1250, 0)).toBe(0);
    expect(calcTransferCostCents(0, 7)).toBe(0);
  });

  it("formatTransferNumber: 1 → TRANSF-000001", () => {
    expect(formatTransferNumber(1)).toBe("TRANSF-000001");
    expect(formatTransferNumber(42)).toBe("TRANSF-000042");
    expect(formatTransferNumber(0)).toBe("TRANSF-000000");
    expect(formatTransferNumber(Number.NaN)).toBe("TRANSF-000000");
  });
});
