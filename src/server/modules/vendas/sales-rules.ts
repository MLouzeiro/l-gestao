// Regras puras de venda (TDD: tests/unit/sales-rules.test.ts).
// Nenhum acesso a banco aqui — só máquina de estados, totais e desconto por papel.
// Dinheiro sempre em centavos (integer); quantidade aceita casa decimal.

export type SaleStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "BILLED"
  | "CANCELLED"
  | "RETURNED";

export type RuleResult = { ok: true } | { ok: false; reason: string };

const TRANSITIONS: Record<SaleStatus, readonly SaleStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["BILLED", "CANCELLED"],
  BILLED: ["RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

function isSaleStatus(value: string): value is SaleStatus {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
}

/**
 * Transições permitidas: DRAFT → CONFIRMED → BILLED; CANCELLED é terminal;
 * BILLED só admite RETURNED (devolução, etapa posterior) — o resto é imutável.
 */
export function assertTransition(from: string, to: string): RuleResult {
  if (!isSaleStatus(from) || !isSaleStatus(to)) {
    return { ok: false, reason: `Status de venda inválido (${from} → ${to}).` };
  }
  if (from === "BILLED") {
    if (to === "RETURNED") return { ok: true };
    return {
      ok: false,
      reason: "Venda já faturada é imutável: correção por devolução/estorno.",
    };
  }
  if (from === "CANCELLED") {
    return { ok: false, reason: "Venda cancelada é estado final." };
  }
  if (from === to) {
    return { ok: false, reason: `Venda já está em ${from}.` };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `Transição inválida: ${from} → ${to}.` };
  }
  return { ok: true };
}

/** Só rascunho edita; faturada só correge via devolução/estorno. */
export function validateSaleEditing(status: string): RuleResult {
  if (status === "DRAFT") return { ok: true };
  if (status === "BILLED") {
    return {
      ok: false,
      reason: "Venda faturada não é editável: correção é devolução/estorno.",
    };
  }
  if (status === "CONFIRMED") {
    return {
      ok: false,
      reason: "Venda confirmada não é editável: cancele ou fature.",
    };
  }
  return { ok: false, reason: `Venda em ${status} não é editável.` };
}

export type SaleItemInput = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
};

export type SaleTotals = {
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  totalCents: number;
};

export type SaleTotalsResult =
  | { ok: true; totals: SaleTotals }
  | { ok: false; reason: string };

/**
 * Recalcula os totais no servidor (nunca confiar no cliente).
 * subtotal = Σ(qtd × preço); total = subtotal − desconto de item − desconto
 * de pedido, sempre ≥ 0.
 */
export function calcSaleTotals(
  items: readonly SaleItemInput[],
  options: { orderDiscountCents?: number } = {},
): SaleTotalsResult {
  if (items.length === 0) {
    return { ok: false, reason: "Pedido sem itens: adicione ao menos um item." };
  }

  let subtotalCents = 0;
  let itemDiscountCents = 0;

  for (const item of items) {
    const qty = item.quantity;
    const price = item.unitPriceCents;
    const discount = item.discountCents ?? 0;

    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, reason: "Quantidade inválida no item." };
    }
    if (!Number.isInteger(price) || price < 0) {
      return { ok: false, reason: "Preço unitário inválido no item." };
    }
    if (!Number.isInteger(discount) || discount < 0) {
      return { ok: false, reason: "Desconto inválido no item." };
    }

    const lineCents = Math.round(qty * price);
    if (discount > lineCents) {
      return {
        ok: false,
        reason: `Desconto do item (${discount}) excede o valor da linha (${lineCents}).`,
      };
    }

    subtotalCents += lineCents;
    itemDiscountCents += discount;
  }

  const orderDiscount = options.orderDiscountCents ?? 0;
  if (!Number.isFinite(orderDiscount) || orderDiscount < 0) {
    return { ok: false, reason: "Desconto de pedido inválido." };
  }

  const availableCents = subtotalCents - itemDiscountCents;
  if (orderDiscount > availableCents) {
    return {
      ok: false,
      reason: `Desconto do pedido (${orderDiscount}) excede o disponível (${availableCents}).`,
    };
  }

  return {
    ok: true,
    totals: {
      subtotalCents,
      itemDiscountCents,
      orderDiscountCents: orderDiscount,
      totalCents: availableCents - orderDiscount,
    },
  };
}

export type SaleDiscountInput = {
  role: string;
  /** true = o papel tem a permissão sales.discount */
  salesDiscount: boolean;
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  /** tenant_settings.max_desconto_vendedor (percentual) */
  maxDescontoVendedorPct: number;
  /** tenant_settings.max_desconto_gerente (percentual) */
  maxDescontoGerentePct: number;
};

/**
 * Desconto combinado (item + pedido) limitado pelo percentual do papel sobre
 * o subtotal. ADMIN e papéis sem teto definido não têm limite — só a
 * permissão decide.
 */
export function validateSaleDiscount(input: SaleDiscountInput): RuleResult {
  const totalDiscountCents =
    input.itemDiscountCents + input.orderDiscountCents;

  if (totalDiscountCents > 0 && !input.salesDiscount) {
    return {
      ok: false,
      reason: "Seu papel não tem permissão para dar desconto em vendas.",
    };
  }

  if (totalDiscountCents <= 0) return { ok: true };

  const pct =
    input.role === "VENDEDOR"
      ? input.maxDescontoVendedorPct
      : input.role === "GERENTE"
        ? input.maxDescontoGerentePct
        : null;

  if (pct === null) return { ok: true };

  const limitCents = Math.floor((input.subtotalCents * pct) / 100 + 1e-6);
  if (totalDiscountCents > limitCents) {
    return {
      ok: false,
      reason: `Desconto de ${totalDiscountCents} centavos excede o limite de ${pct}% do papel ${input.role}.`,
    };
  }
  return { ok: true };
}

/** Prefixo/largura do número da venda (1 → "VENDA-000001"). */
export const SALE_NUMBER_PREFIX = "VENDA";
export const SALE_NUMBER_WIDTH = 6;

/** 1 → "VENDA-000001" (não inteiro é truncado). */
export function formatSaleNumber(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  return `${SALE_NUMBER_PREFIX}-${String(n).padStart(SALE_NUMBER_WIDTH, "0")}`;
}
