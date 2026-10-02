import {
  FinancialError,
  computeAccountStatus,
  splitInstallments,
  validatePayment,
} from "@/server/modules/financeiro/financial-rules";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe("splitInstallments", () => {
  it("1x = parcela única com o valor total no vencimento base", () => {
    const parts = splitInstallments(15000, 1, d("2026-03-10"));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.number).toBe(1);
    expect(parts[0]!.amountCents).toBe(15000);
    expect(parts[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("3x de R$100,00 = 10000 em cada parcela", () => {
    const parts = splitInstallments(30000, 3, d("2026-03-10"));
    expect(parts.map((p) => p.amountCents)).toEqual([10000, 10000, 10000]);
    expect(parts.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(parts.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-03-10",
      "2026-04-10",
      "2026-05-10",
    ]);
  });

  it("soma das parcelas é sempre igual ao total (resto na última)", () => {
    const parts = splitInstallments(10000, 3, d("2026-01-15"));
    expect(parts.map((p) => p.amountCents)).toEqual([3333, 3333, 3334]);
    expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(10000);
  });

  it("vencimentos mensais com clamp de fim de mês (31/01 → 28/02)", () => {
    const parts = splitInstallments(30000, 3, d("2026-01-31"));
    expect(parts.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("clamp em ano bissexto (31/01/2028 → 29/02/2028)", () => {
    const parts = splitInstallments(20000, 2, d("2028-01-31"));
    expect(parts[1].dueDate.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("total inválido lança erro", () => {
    expect(() => splitInstallments(0, 1, d("2026-01-01"))).toThrow(FinancialError);
    expect(() => splitInstallments(-100, 1, d("2026-01-01"))).toThrow(FinancialError);
  });

  it("quantidade de parcelas fora de 1..99 lança erro", () => {
    expect(() => splitInstallments(1000, 0, d("2026-01-01"))).toThrow(FinancialError);
    expect(() => splitInstallments(1000, 100, d("2026-01-01"))).toThrow(FinancialError);
  });
});

describe("computeAccountStatus", () => {
  const base = { amountCents: 10000 };

  it("sem pagamento e vencimento futuro = OPEN", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 0, dueDate: d("2026-10-10"), today: d("2026-10-01") }),
    ).toBe("OPEN");
  });

  it("vencida sem pagamento = OVERDUE", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 0, dueDate: d("2026-09-30"), today: d("2026-10-01") }),
    ).toBe("OVERDUE");
  });

  it("pagamento parcial no prazo = PARTIAL", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 4000, dueDate: d("2026-10-10"), today: d("2026-10-01") }),
    ).toBe("PARTIAL");
  });

  it("pagamento parcial vencida = OVERDUE (atraso vence parcial)", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 4000, dueDate: d("2026-09-01"), today: d("2026-10-01") }),
    ).toBe("OVERDUE");
  });

  it("quitada = PAID mesmo após o vencimento", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 10000, dueDate: d("2026-09-01"), today: d("2026-10-01") }),
    ).toBe("PAID");
  });

  it("vencida no próprio dia ainda conta como no prazo", () => {
    expect(
      computeAccountStatus({ ...base, paidCents: 0, dueDate: d("2026-10-01"), today: d("2026-10-01") }),
    ).toBe("OPEN");
  });

  it("pago maior que o valor lança FinancialError", () => {
    expect(() =>
      computeAccountStatus({ ...base, paidCents: 10001, dueDate: d("2026-10-10"), today: d("2026-10-01") }),
    ).toThrow(FinancialError);
    expect(() =>
      computeAccountStatus({ ...base, paidCents: -1, dueDate: d("2026-10-10"), today: d("2026-10-01") }),
    ).toThrow(FinancialError);
  });
});

describe("validatePayment", () => {
  it("baixa válida até o saldo", () => {
    expect(validatePayment({ amountCents: 5000, interestCents: 0, discountCents: 0, remainingCents: 10000 })).toEqual({
      ok: true,
    });
    expect(validatePayment({ amountCents: 10000, interestCents: 0, discountCents: 0, remainingCents: 10000 })).toEqual({
      ok: true,
    });
  });

  it("valor zero/negativo é recusado", () => {
    expect(validatePayment({ amountCents: 0, interestCents: 0, discountCents: 0, remainingCents: 10000 })).toEqual({
      ok: false,
      reason: "Informe o valor da baixa maior que zero.",
    });
  });

  it("baixa maior que o saldo é recusada (paid_amount ≤ amount)", () => {
    expect(validatePayment({ amountCents: 10001, interestCents: 0, discountCents: 0, remainingCents: 10000 })).toEqual({
      ok: false,
      reason: "Valor da baixa maior que o saldo da conta.",
    });
  });

  it("juros/desconto negativos são recusados", () => {
    expect(validatePayment({ amountCents: 100, interestCents: -1, discountCents: 0, remainingCents: 1000 })).toEqual({
      ok: false,
      reason: "Juros e desconto não podem ser negativos.",
    });
    expect(validatePayment({ amountCents: 100, interestCents: 0, discountCents: -5, remainingCents: 1000 })).toEqual({
      ok: false,
      reason: "Juros e desconto não podem ser negativos.",
    });
  });
});
