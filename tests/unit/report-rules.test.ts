import {
  ReportError,
  aggregatePurchasesByProduct,
  aggregatePurchasesBySupplier,
  aggregateSalesByDay,
  aggregateSalesByProduct,
  aggregateSalesBySeller,
  assertReportTipo,
  buildCsvFilename,
  calcMargin,
  clampPage,
  classifyStockLevel,
  csvMoney,
  csvQty,
  escapeCsvField,
  isIsoDate,
  normalizeRange,
  paginate,
  REPORT_TIPOS,
  stockValueCents,
  summarizeAccounts,
  toCsv,
  totalPages,
  type AccountFact,
  type PurchaseFact,
  type PurchaseItemFact,
  type SaleFact,
  type SaleItemFact,
} from "@/server/modules/relatorios/report-rules";

describe("isIsoDate", () => {
  it("aceita datas ISO válidas", () => {
    expect(isIsoDate("2026-10-02")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // bissexto
    expect(isIsoDate("2026-12-31")).toBe(true);
  });

  it("rejeita formatos e dias impossíveis", () => {
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("02/10/2026")).toBe(false);
    expect(isIsoDate("2026-10-02T00:00:00Z")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-29")).toBe(false); // não bissexto
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2026-10-00")).toBe(false);
    expect(isIsoDate("2026-10-32")).toBe(false);
    expect(isIsoDate("lixo")).toBe(false);
  });
});

describe("normalizeRange", () => {
  it("aceita período completo", () => {
    expect(normalizeRange("2026-10-01", "2026-10-31")).toEqual({
      de: "2026-10-01",
      ate: "2026-10-31",
    });
  });

  it("aceita sem datas (sem filtro de período)", () => {
    expect(normalizeRange(undefined, undefined)).toEqual({});
    expect(normalizeRange("", "")).toEqual({});
    expect(normalizeRange("2026-10-01", undefined)).toEqual({
      de: "2026-10-01",
    });
    expect(normalizeRange(undefined, "2026-10-31")).toEqual({
      ate: "2026-10-31",
    });
  });

  it("rejeita data inicial depois da final", () => {
    expect(() => normalizeRange("2026-11-01", "2026-10-31")).toThrow(
      ReportError,
    );
    try {
      normalizeRange("2026-11-01", "2026-10-31");
    } catch (err) {
      expect((err as ReportError).message).toBe(
        "Período inválido: a data inicial não pode ser posterior à final.",
      );
    }
  });

  it("rejeita formato de data inválido", () => {
    expect(() => normalizeRange("ontem", undefined)).toThrow(ReportError);
    expect(() => normalizeRange(undefined, "31/10/2026")).toThrow(ReportError);
  });
});

describe("assertReportTipo", () => {
  it("aceita os 4 tipos", () => {
    for (const t of REPORT_TIPOS) {
      expect(() => assertReportTipo(t)).not.toThrow();
    }
  });

  it("rejeita tipo desconhecido com mensagem pt-BR", () => {
    try {
      assertReportTipo("maligno");
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(ReportError);
      expect((err as ReportError).message).toBe("Relatório inválido.");
    }
  });
});

describe("classifyStockLevel", () => {
  it("saldo zerado ou negativo é CRITICO", () => {
    expect(classifyStockLevel(0, 10)).toBe("CRITICO");
    expect(classifyStockLevel(-1, 0)).toBe("CRITICO");
    expect(classifyStockLevel(0, 0)).toBe("CRITICO");
  });

  it("abaixo ou igual ao mínimo (com saldo) é BAIXO", () => {
    expect(classifyStockLevel(5, 10)).toBe("BAIXO");
    expect(classifyStockLevel(10, 10)).toBe("BAIXO");
  });

  it("acima do mínimo é OK; sem mínimo configurado também OK", () => {
    expect(classifyStockLevel(11, 10)).toBe("OK");
    expect(classifyStockLevel(5, 0)).toBe("OK");
    expect(classifyStockLevel(0.001, 0)).toBe("OK");
  });
});

describe("stockValueCents", () => {
  it("multiplica quantidade × custo em centavos com arredondamento", () => {
    expect(stockValueCents(10, 1250)).toBe(12500);
    expect(stockValueCents(10.5, 1250)).toBe(13125);
    expect(stockValueCents(0.333, 100)).toBe(33);
    expect(stockValueCents(0, 999)).toBe(0);
  });
});

describe("calcMargin", () => {
  it("margem em R$ e % sobre o custo", () => {
    expect(calcMargin(10000, 7000)).toEqual({
      marginCents: 3000,
      marginPct: 42.86,
    });
    expect(calcMargin(7000, 10000)).toEqual({
      marginCents: -3000,
      marginPct: -30,
    });
    expect(calcMargin(5000, 7000)).toEqual({
      marginCents: -2000,
      marginPct: -28.57,
    });
  });

  it("sem custo o percentual é null (não divide por zero)", () => {
    expect(calcMargin(10000, 0)).toEqual({ marginCents: 10000, marginPct: null });
    expect(calcMargin(0, 0)).toEqual({ marginCents: 0, marginPct: null });
  });
});

describe("escapeCsvField / toCsv", () => {
  it("campo simples fica como está", () => {
    expect(escapeCsvField("Café torrado")).toBe("Café torrado");
    expect(escapeCsvField("12,50")).toBe("12,50");
  });

  it("envolve em aspas quando há separador, aspa ou quebra de linha", () => {
    expect(escapeCsvField("a;b")).toBe('"a;b"');
    expect(escapeCsvField('diga "oi"')).toBe('"diga ""oi"""');
    expect(escapeCsvField("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(escapeCsvField("linha1\r\nlinha2")).toBe('"linha1\r\nlinha2"');
  });

  it("toCsv: BOM UTF-8, separador ; e fim de linha CRLF", () => {
    const csv = toCsv(["Nome", "Total"], [["Café; especial", "1.234,56"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    const linhas = csv.replace("﻿", "").split("\r\n");
    expect(linhas[0]).toBe("Nome;Total");
    expect(linhas[1]).toBe('"Café; especial";1.234,56');
    expect(linhas[2]).toBe("");
  });

  it("toCsv aceita números pré-formatados como string", () => {
    const csv = toCsv(["Qtd"], [[10]]);
    expect(csv).toContain("Qtd\r\n10\r\n");
  });
});

describe("csvMoney / csvQty", () => {
  it("formato pt-BR com separador ; seguro para o CSV", () => {
    expect(csvMoney(123456)).toBe("1.234,56");
    expect(csvMoney(500)).toBe("5,00");
    expect(csvMoney(0)).toBe("0,00");
    expect(csvMoney(-500)).toBe("-5,00");
  });

  it("quantidade com até 3 casas sem zeros desnecessários", () => {
    expect(csvQty(10)).toBe("10");
    expect(csvQty(10.5)).toBe("10,5");
    expect(csvQty(10.125)).toBe("10,125");
    expect(csvQty(0.333)).toBe("0,333");
  });
});

describe("buildCsvFilename", () => {
  it("monta nome com tipo e período", () => {
    expect(buildCsvFilename("estoque", "2026-10-01", "2026-10-31")).toBe(
      "relatorio-estoque_2026-10-01_2026-10-31.csv",
    );
    expect(buildCsvFilename("vendas", "2026-10-01", undefined)).toBe(
      "relatorio-vendas_2026-10-01.csv",
    );
    expect(buildCsvFilename("financeiro", undefined, undefined)).toBe(
      "relatorio-financeiro.csv",
    );
  });
});

describe("clampPage / totalPages", () => {
  it("normaliza página inválida para 1", () => {
    expect(clampPage("")).toBe(1);
    expect(clampPage("0")).toBe(1);
    expect(clampPage("-3")).toBe(1);
    expect(clampPage("abc")).toBe(1);
    expect(clampPage("4")).toBe(4);
  });

  it("totalPages sempre ≥ 1", () => {
    expect(totalPages(0, 20)).toBe(1);
    expect(totalPages(20, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(45, 20)).toBe(3);
  });
});

describe("paginate", () => {
  it("fatia a página correta e mantém o total", () => {
    const rows = Array.from({ length: 25 }, (_, i) => i + 1);
    const p1 = paginate(rows, 1, 10);
    expect(p1.rows).toHaveLength(10);
    expect(p1.rows[0]).toBe(1);
    expect(p1.total).toBe(25);
    const p3 = paginate(rows, 3, 10);
    expect(p3.rows).toEqual([21, 22, 23, 24, 25]);
    const beyond = paginate(rows, 9, 10);
    expect(beyond.rows).toEqual([]);
    expect(beyond.total).toBe(25);
  });
});

describe("aggregateSalesByDay", () => {
  const facts: SaleFact[] = [
    { saleId: "s1", billedDay: "2026-10-01", sellerId: "u1", sellerName: "Ana", quantity: 2, grossCents: 10000, discountCents: 500, netCents: 9500, costCents: 6000 },
    { saleId: "s2", billedDay: "2026-10-01", sellerId: "u1", sellerName: "Ana", quantity: 1, grossCents: 5000, discountCents: 0, netCents: 5000, costCents: 3000 },
    { saleId: "s3", billedDay: "2026-10-03", sellerId: "u2", sellerName: "Bia", quantity: 3, grossCents: 20000, discountCents: 1000, netCents: 19000, costCents: 12000 },
  ];

  it("soma por dia, ordena do mais recente e calcula margem", () => {
    const rows = aggregateSalesByDay(facts);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("2026-10-03");
    expect(rows[0]).toMatchObject({ orders: 1, quantity: 3, netCents: 19000, costCents: 12000, marginCents: 7000 });
    expect(rows[0].marginPct).toBe(58.33);
    expect(rows[1].key).toBe("2026-10-01");
    expect(rows[1]).toMatchObject({ orders: 2, quantity: 3, grossCents: 15000, discountCents: 500, netCents: 14500, costCents: 9000 });
  });

  it("lista vazia devolve vazio", () => {
    expect(aggregateSalesByDay([])).toEqual([]);
  });
});

describe("aggregateSalesBySeller", () => {
  it("agrupa por vendedor, usa marcador sem vendedor e ordena por liquido", () => {
    const rows = aggregateSalesBySeller([
      { saleId: "s1", billedDay: "2026-10-01", sellerId: null, sellerName: null, quantity: 1, grossCents: 1000, discountCents: 0, netCents: 1000, costCents: 500 },
      { saleId: "s2", billedDay: "2026-10-01", sellerId: "u1", sellerName: "Ana", quantity: 2, grossCents: 9000, discountCents: 0, netCents: 9000, costCents: 5000 },
      { saleId: "s3", billedDay: "2026-10-02", sellerId: "u2", sellerName: "Bia", quantity: 1, grossCents: 5000, discountCents: 0, netCents: 5000, costCents: 3000 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["Ana", "Bia", "(sem vendedor)"]);
    expect(rows[0].orders).toBe(1);
    expect(rows[2].netCents).toBe(1000);
  });
});

describe("aggregateSalesByProduct", () => {
  it("agrupa itens, conta vendas distintas e usa receita do item", () => {
    const rows = aggregateSalesByProduct([
      { saleId: "s1", productId: "p1", productName: "Café", quantity: 2, grossCents: 4000, itemDiscountCents: 200, costCents: 2500 },
      { saleId: "s2", productId: "p1", productName: "Café", quantity: 1, grossCents: 2000, itemDiscountCents: 0, costCents: 1200 },
      { saleId: "s2", productId: "p2", productName: "Açúcar", quantity: 3, grossCents: 900, itemDiscountCents: 0, costCents: 600 },
    ] satisfies SaleItemFact[]);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("Café");
    expect(rows[0]).toMatchObject({ orders: 2, quantity: 3, grossCents: 6000, discountCents: 200, netCents: 5800, costCents: 3700 });
    expect(rows[1].key).toBe("Açúcar");
    expect(rows[1].orders).toBe(1);
  });
});

describe("aggregatePurchasesBySupplier / ByProduct", () => {
  it("soma notas por fornecedor e ordena por total", () => {
    const rows = aggregatePurchasesBySupplier([
      { entryId: "e1", entryDay: "2026-10-01", supplierId: "f1", supplierName: "Distribuidora X", totalCents: 50000 },
      { entryId: "e2", entryDay: "2026-10-02", supplierId: "f1", supplierName: "Distribuidora X", totalCents: 20000 },
      { entryId: "e3", entryDay: "2026-10-02", supplierId: "f2", supplierName: "Atacado Y", totalCents: 30000 },
    ] satisfies PurchaseFact[]);
    expect(rows[0]).toMatchObject({ key: "Distribuidora X", orders: 2, totalCents: 70000 });
    expect(rows[1]).toMatchObject({ key: "Atacado Y", orders: 1, totalCents: 30000 });
  });

  it("soma quantidade e conta notas distintas por produto", () => {
    const rows = aggregatePurchasesByProduct([
      { entryId: "e1", productId: "p1", productName: "Café", quantity: 10, totalCents: 125000 },
      { entryId: "e2", productId: "p1", productName: "Café", quantity: 5, totalCents: 60000 },
      { entryId: "e2", productId: "p2", productName: "Açúcar", quantity: 20, totalCents: 50000 },
    ] satisfies PurchaseItemFact[]);
    expect(rows[0]).toMatchObject({ key: "Café", orders: 2, quantity: 15, totalCents: 185000 });
    expect(rows[1]).toMatchObject({ key: "Açúcar", orders: 1, quantity: 20, totalCents: 50000 });
  });
});

describe("summarizeAccounts", () => {
  const today = "2026-10-02";
  const facts: AccountFact[] = [
    { accountId: "a1", direction: "RECEIVABLE", status: "PAID", dueDate: "2026-09-10", amountCents: 10000, paidCents: 10000 },
    { accountId: "a2", direction: "RECEIVABLE", status: "OVERDUE", dueDate: "2026-09-20", amountCents: 5000, paidCents: 2000 },
    { accountId: "a3", direction: "RECEIVABLE", status: "OPEN", dueDate: "2026-10-20", amountCents: 8000, paidCents: 0 },
    { accountId: "a4", direction: "RECEIVABLE", status: "OPEN", dueDate: "2026-10-01", amountCents: 3000, paidCents: 0 },
    { accountId: "a5", direction: "RECEIVABLE", status: "CANCELLED", dueDate: "2026-10-01", amountCents: 1000, paidCents: 0 },
  ];

  it("agrega contagem e valores por status", () => {
    const s = summarizeAccounts(facts, today);
    expect(s.byStatus.PAID).toEqual({ count: 1, amountCents: 10000, paidCents: 10000 });
    expect(s.byStatus.OPEN.count).toBe(2);
    expect(s.byStatus.CANCELLED.count).toBe(1);
    expect(s.byStatus.OVERDUE).toEqual({ count: 1, amountCents: 5000, paidCents: 2000 });
  });

  it("openCents = saldo em aberto (OPEN+PARTIAL+OVERDUE) e inadimplência inclui vencida por data", () => {
    const s = summarizeAccounts(facts, today);
    // a2: 3000 + a3: 8000 + a4: 3000 = 14000 (PAID/CANCELLED fora)
    expect(s.openCents).toBe(14000);
    // a2 (status OVERDUE, saldo 3000) + a4 (OPEN vencida ontem, 3000)
    expect(s.overdueCents).toBe(6000);
    expect(s.overdueCount).toBe(2);
  });

  it("sem contas devolve zeros estruturados", () => {
    const s = summarizeAccounts([], today);
    expect(s.openCents).toBe(0);
    expect(s.overdueCents).toBe(0);
    expect(s.byStatus.PAID.count).toBe(0);
  });
});
