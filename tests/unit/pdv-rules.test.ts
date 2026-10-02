import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import {
  PAYMENT_METHOD_BUCKET,
  PdvError,
  calcTroco,
  computeDifference,
  computeExpectedByBucket,
  validatePdvPayment,
  validateSangria,
  type CashBucket,
} from "@/server/modules/pdv/pdv-rules";

// Regras puras do PDV: troco, pagamento, livro-caixa (esperado por forma) e
// limites de sangria — tests/unit/pdv-rules.test.ts (TDD: RED → GREEN).

describe("calcTroco", () => {
  it("recebido 10000 com total 7500 → troco 2500", () => {
    const r = calcTroco(10000, 7500);
    expect(r).toEqual({ ok: true, trocoCents: 2500 });
  });

  it("recebido igual ao total → troco zero", () => {
    expect(calcTroco(7500, 7500)).toEqual({ ok: true, trocoCents: 0 });
  });

  it("recebido menor que o total → recusa", () => {
    const r = calcTroco(1000, 7500);
    expect(r.ok).toBe(false);
  });

  it("valores negativos ou NaN → recusa", () => {
    expect(calcTroco(-1, 100).ok).toBe(false);
    expect(calcTroco(Number.NaN, 100).ok).toBe(false);
  });
});

describe("validatePdvPayment", () => {
  it("DINHEIRO sem valor recebido → recusa", () => {
    const r = validatePdvPayment({
      paymentMethod: "DINHEIRO",
      installments: 1,
      totalCents: 5000,
    });
    expect(r.ok).toBe(false);
  });

  it("DINHEIRO cobre o total → ok com troco", () => {
    const r = validatePdvPayment({
      paymentMethod: "DINHEIRO",
      installments: 1,
      totalCents: 5000,
      receivedCents: 20000,
    });
    expect(r).toEqual({ ok: true, trocoCents: 15000 });
  });

  it("CREDITO aceita 1..12 parcelas; 13 é recusado", () => {
    expect(
      validatePdvPayment({
        paymentMethod: "CREDITO",
        installments: 12,
        totalCents: 5000,
      }),
    ).toEqual({ ok: true, trocoCents: 0 });
    expect(
      validatePdvPayment({
        paymentMethod: "CREDITO",
        installments: 13,
        totalCents: 5000,
      }).ok,
    ).toBe(false);
    expect(
      validatePdvPayment({
        paymentMethod: "CREDITO",
        installments: 0,
        totalCents: 5000,
      }).ok,
    ).toBe(false);
  });

  it("DEBITO/PIX/VALE/OUTRO exigem 1 parcela", () => {
    for (const m of ["DEBITO", "PIX", "VALE", "OUTRO"] as const) {
      expect(
        validatePdvPayment({ paymentMethod: m, installments: 1, totalCents: 100 }),
      ).toEqual({ ok: true, trocoCents: 0 });
      expect(
        validatePdvPayment({ paymentMethod: m, installments: 2, totalCents: 100 })
          .ok,
      ).toBe(false);
    }
  });

  it("total inválido → recusa", () => {
    expect(
      validatePdvPayment({
        paymentMethod: "PIX",
        installments: 1,
        totalCents: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("PAYMENT_METHOD_BUCKET", () => {
  it("mapeia cada forma para seu gaveta de contagem", () => {
    expect(PAYMENT_METHOD_BUCKET.DINHEIRO).toBe("cash");
    expect(PAYMENT_METHOD_BUCKET.PIX).toBe("pix");
    expect(PAYMENT_METHOD_BUCKET.DEBITO).toBe("card");
    expect(PAYMENT_METHOD_BUCKET.CREDITO).toBe("card");
    expect(PAYMENT_METHOD_BUCKET.VALE).toBe("other");
    expect(PAYMENT_METHOD_BUCKET.OUTRO).toBe("other");
  });
});

describe("computeExpectedByBucket", () => {
  it("abertura + vendas por forma + suprimento − sangria", () => {
    const expected = computeExpectedByBucket(10000, [
      { type: "VENDA", amountCents: 5000, paymentMethod: "DINHEIRO" },
      { type: "VENDA", amountCents: 3000, paymentMethod: "PIX" },
      { type: "VENDA", amountCents: 2000, paymentMethod: "CREDITO" },
      { type: "SUPRIMENTO", amountCents: 2000, paymentMethod: null },
      { type: "SANGRIA", amountCents: 1000, paymentMethod: null },
    ]);
    const buckets: CashBucket[] = ["cash", "card", "pix", "other"];
    expect(buckets.map((b) => expected[b])).toEqual([16000, 2000, 3000, 0]);
  });

  it("lançamentos ABERTURA/FECHAMENTO não entram no esperado", () => {
    const expected = computeExpectedByBucket(5000, [
      { type: "ABERTURA", amountCents: 5000, paymentMethod: null },
      { type: "FECHAMENTO", amountCents: 999999, paymentMethod: null },
    ]);
    expect(expected).toEqual({ cash: 5000, card: 0, pix: 0, other: 0 });
  });
});

describe("validateSangria", () => {
  it("sangria até o saldo em caixa → ok", () => {
    expect(validateSangria(5000, 15000)).toEqual({ ok: true });
  });

  it("sangria acima do saldo ou não positiva → recusa", () => {
    expect(validateSangria(20000, 15000).ok).toBe(false);
    expect(validateSangria(0, 15000).ok).toBe(false);
    expect(validateSangria(-100, 15000).ok).toBe(false);
  });
});

describe("computeDifference", () => {
  it("diferença = contagem total − esperado total (sobrou → positiva)", () => {
    const counted: Record<CashBucket, number> = {
      cash: 16500,
      card: 2000,
      pix: 3000,
      other: 0,
    };
    const expected: Record<CashBucket, number> = {
      cash: 16000,
      card: 2000,
      pix: 3000,
      other: 0,
    };
    expect(computeDifference(counted, expected)).toBe(500);
    expect(
      computeDifference({ ...counted, cash: 15500 }, expected),
    ).toBe(-500);
    expect(computeDifference(counted, expected)).toBe(500);
  });
});

describe("RBAC do PDV (checklist: vendedor não executa operação de admin)", () => {
  it("VENDEDOR vende (sales.manage) mas não faz sangria (finance.manage)", () => {
    expect(() => assertPermission("VENDEDOR", "sales.manage")).not.toThrow();
    try {
      assertPermission("VENDEDOR", "finance.manage");
      throw new Error("deveria ter recusado");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).status).toBe(403);
    }
  });
});

describe("PdvError", () => {
  it("é Error com mensagem em pt-BR", () => {
    const e = new PdvError("Abra o caixa antes de vender.");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("caixa");
    expect(e.name).toBe("PdvError");
  });
});
