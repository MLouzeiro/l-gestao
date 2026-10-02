import {
  MAX_SERIES_DAYS,
  buildDailySeries,
  nextDueAccounts,
  rankSellers,
  summarizeFunnel,
  ticketAvgCents,
  type SaleStatus,
} from "@/server/modules/dashboard/dashboard-rules";
import {
  ReportError,
  type AccountFact,
  type SalesAggregateRow,
} from "@/server/modules/relatorios/report-rules";

function row(key: string, netCents: number, orders = 1): SalesAggregateRow {
  return {
    key,
    orders,
    quantity: 1,
    grossCents: netCents,
    discountCents: 0,
    netCents,
    costCents: 0,
    marginCents: netCents,
    marginPct: null,
  };
}

describe("buildDailySeries", () => {
  it("preenche dias sem venda com zero em ordem crescente (UTC)", () => {
    const points = buildDailySeries("2026-10-01", "2026-10-05", [
      row("2026-10-04", 4000, 2),
      row("2026-10-02", 2500, 1),
    ]);
    expect(points.map((p) => p.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(points.map((p) => p.netCents)).toEqual([0, 2500, 0, 4000, 0]);
    expect(points.map((p) => p.orders)).toEqual([0, 1, 0, 2, 0]);
  });

  it("ignora linhas fora da janela do período", () => {
    const points = buildDailySeries("2026-10-01", "2026-10-03", [
      row("2026-09-30", 999),
      row("2026-10-02", 100),
      row("2026-10-04", 888),
    ]);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.netCents)).toEqual([0, 100, 0]);
  });

  it("cruza fronteira de mês e ano", () => {
    const points = buildDailySeries("2026-12-30", "2027-01-01", []);
    expect(points.map((p) => p.day)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("aceita período de um dia", () => {
    const points = buildDailySeries("2026-10-02", "2026-10-02", [
      row("2026-10-02", 700, 3),
    ]);
    expect(points).toEqual([{ day: "2026-10-02", netCents: 700, orders: 3 }]);
  });

  it("lança ReportError se a data inicial é posterior à final", () => {
    expect(() =>
      buildDailySeries("2026-10-05", "2026-10-01", []),
    ).toThrow(ReportError);
  });

  it("lança ReportError se falta uma das datas", () => {
    expect(() => buildDailySeries("", "2026-10-01", [])).toThrow(ReportError);
    expect(() => buildDailySeries("2026-10-01", "", [])).toThrow(ReportError);
  });

  it("lança ReportError se a data é inválida", () => {
    expect(() => buildDailySeries("02/10/2026", "2026-10-01", [])).toThrow(
      ReportError,
    );
    expect(() => buildDailySeries("2026-10-01", "2026-02-30", [])).toThrow(
      ReportError,
    );
  });

  it(`lança ReportError se ultrapassa ${MAX_SERIES_DAYS} dias`, () => {
    // 2026 não é bissexto: 01/01/2026 → 01/01/2027 inclusive = 366 dias
    expect(() =>
      buildDailySeries("2026-01-01", "2027-01-01", []),
    ).not.toThrow();
    expect(() =>
      buildDailySeries("2026-01-01", "2027-01-02", []),
    ).toThrow(ReportError);
  });
});

describe("summarizeFunnel", () => {
  it("conta vendas por status e calcula o total", () => {
    const funnel = summarizeFunnel([
      { status: "DRAFT" },
      { status: "DRAFT" },
      { status: "CONFIRMED" },
      { status: "BILLED" },
      { status: "BILLED" },
      { status: "CANCELLED" },
    ]);
    expect(funnel).toEqual({
      DRAFT: 2,
      CONFIRMED: 1,
      BILLED: 2,
      CANCELLED: 1,
      RETURNED: 0,
      total: 6,
    });
  });

  it("zera status ausentes e ignora status desconhecido", () => {
    const funnel = summarizeFunnel([
      { status: "BILLED" },
      { status: "QUALQUER_COISA" },
    ]);
    expect(funnel.DRAFT).toBe(0);
    expect(funnel.RETURNED).toBe(0);
    expect(funnel.BILLED).toBe(1);
    expect(funnel.total).toBe(1);
  });

  it("lista vazia retorna tudo zero", () => {
    expect(summarizeFunnel([])).toEqual({
      DRAFT: 0,
      CONFIRMED: 0,
      BILLED: 0,
      CANCELLED: 0,
      RETURNED: 0,
      total: 0,
    });
  });

  it("expõe o tipo SaleStatus com os 5 status da venda", () => {
    const status: SaleStatus = "RETURNED";
    expect(status).toBe("RETURNED");
  });
});

describe("ticketAvgCents", () => {
  it("divide o faturamento pelo número de vendas", () => {
    expect(ticketAvgCents(6000, 4)).toBe(1500);
  });

  it("arredonda para o centavo mais próximo", () => {
    expect(ticketAvgCents(500, 3)).toBe(167);
    expect(ticketAvgCents(1000, 3)).toBe(333);
  });

  it("retorna null quando não há vendas", () => {
    expect(ticketAvgCents(6000, 0)).toBeNull();
    expect(ticketAvgCents(6000, -1)).toBeNull();
  });
});

describe("rankSellers", () => {
  const rows = [
    row("Ana", 3000),
    row("Bia", 8000),
    row("Caio", 5000),
  ];

  it("mantém a ordenação (maior faturamento primeiro) e aplica o limite", () => {
    expect(rankSellers(rows, 2).map((r) => r.key)).toEqual(["Bia", "Caio"]);
  });

  it("limite maior que o total devolve tudo", () => {
    expect(rankSellers(rows, 10)).toHaveLength(3);
  });

  it("limite zero ou negativo devolve vazio", () => {
    expect(rankSellers(rows, 0)).toEqual([]);
    expect(rankSellers(rows, -1)).toEqual([]);
  });

  it("lista vazia devolve vazio", () => {
    expect(rankSellers([], 5)).toEqual([]);
  });

  it("desempata empate de faturamento pelo nome", () => {
    const empate = [row("Zeca", 5000), row("Ana", 5000), row("Bia", 9000)];
    expect(rankSellers(empate, 3).map((r) => r.key)).toEqual([
      "Bia",
      "Ana",
      "Zeca",
    ]);
  });
});

describe("nextDueAccounts", () => {
  const today = "2026-10-02";
  const accounts: AccountFact[] = [
    {
      accountId: "a1",
      direction: "RECEIVABLE",
      status: "OPEN",
      dueDate: "2026-10-10",
      amountCents: 1000,
      paidCents: 0,
    },
    {
      accountId: "a2",
      direction: "RECEIVABLE",
      status: "OPEN",
      dueDate: "2026-10-05",
      amountCents: 2000,
      paidCents: 0,
    },
    {
      accountId: "a3",
      direction: "RECEIVABLE",
      status: "OVERDUE",
      dueDate: "2026-09-30",
      amountCents: 3000,
      paidCents: 0,
    },
    {
      accountId: "a4",
      direction: "RECEIVABLE",
      status: "PAID",
      dueDate: "2026-10-08",
      amountCents: 4000,
      paidCents: 4000,
    },
    {
      accountId: "a5",
      direction: "PAYABLE",
      status: "OPEN",
      dueDate: "2026-10-03",
      amountCents: 5000,
      paidCents: 0,
    },
    {
      accountId: "a6",
      direction: "RECEIVABLE",
      status: "CANCELLED",
      dueDate: "2026-10-04",
      amountCents: 6000,
      paidCents: 0,
    },
    {
      accountId: "a7",
      direction: "RECEIVABLE",
      status: "PARTIAL",
      dueDate: "2026-10-15",
      amountCents: 7000,
      paidCents: 2000,
    },
  ];

  it("seleciona só a receber em aberto, com vencimento a partir de hoje, ordenado por data", () => {
    const next = nextDueAccounts(accounts, today, 5);
    expect(next.map((a) => a.accountId)).toEqual(["a2", "a1", "a7"]);
  });

  it("ignora pagas, canceladas, a pagar e já vencidas", () => {
    const next = nextDueAccounts(accounts, today, 10);
    const ids = next.map((a) => a.accountId);
    expect(ids).not.toContain("a3"); // vencida (a lista é de PRÓXIMOS vencimentos)
    expect(ids).not.toContain("a4"); // paga
    expect(ids).not.toContain("a5"); // a pagar
    expect(ids).not.toContain("a6"); // cancelada
  });

  it("respeita o limite", () => {
    expect(nextDueAccounts(accounts, today, 2)).toHaveLength(2);
  });

  it("lista vazia ou limite zero devolve vazio", () => {
    expect(nextDueAccounts([], today, 5)).toEqual([]);
    expect(nextDueAccounts(accounts, today, 0)).toEqual([]);
  });
});
