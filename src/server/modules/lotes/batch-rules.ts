// Regras puras de lotes e validade (E5) — sem banco. Datas em "YYYY-MM-DD"
// (comparação lexicográfica = cronológica), convenção do fefo-rules.

export type ExpiryStatus =
  | "VENCIDO"
  | "CRITICO"
  | "PROXIMO"
  | "OK"
  | "SEM_VALIDADE";

export type TraceMovement = {
  id: string;
  type: string;
  quantity: number;
  occurredAt: string;
  warehouseName: string;
  userName: string | null;
  saleId: string | null;
  saleNumber: number | null;
  customerName: string | null;
};

export type BatchLabel = {
  productName: string;
  batchNumber: string;
  expiresText: string;
  code: string;
  quantityText: string;
};

export type TraceSummary = {
  entradas: number;
  saidas: number;
  saldo: number;
  vendas: number;
  clientes: string[];
};

const ENTRADA_PREFIX = "ENTRADA";

function fmtDateBr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** Diferença em dias entre validade e hoje (negativa = vencido). */
export function daysUntil(
  expiresAt: string | null,
  hoje: string,
): number | null {
  if (!expiresAt) return null;
  const [y1, m1, d1] = hoje.split("-").map(Number);
  const [y2, m2, d2] = expiresAt.split("-").map(Number);
  const t1 = Date.UTC(y1!, m1! - 1, d1!);
  const t2 = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * Classifica a validade de um lote:
 * - `VENCIDO`: validade estritamente anterior a hoje (no dia ainda vale);
 * - `CRITICO`/`PROXIMO`: dentro da menor/maior janela de alerta
 *   (`dias_alerta_validade` do tenant_settings — ex.: [7, 30]);
 * - `OK`: fora das janelas; `SEM_VALIDADE`: sem data.
 */
export function classifyExpiry(
  expiresAt: string | null,
  alertWindows: readonly number[],
  hoje: string,
): ExpiryStatus {
  if (!expiresAt) return "SEM_VALIDADE";
  const dias = daysUntil(expiresAt, hoje)!;
  if (dias < 0) return "VENCIDO";

  const janelas = [...new Set(alertWindows)]
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  for (const limite of janelas) {
    if (dias <= limite) {
      // menor janela (ou a primeira alcançada) = mais crítico
      return limite === janelas[0] ? "CRITICO" : "PROXIMO";
    }
  }
  return "OK";
}

/** Rótulo pt-BR do status de validade (usado em badges). */
export function expiryLabel(status: ExpiryStatus): string {
  return (
    {
      VENCIDO: "Vencido",
      CRITICO: "Crítico",
      PROXIMO: "Próximo",
      OK: "OK",
      SEM_VALIDADE: "Sem validade",
    }[status] ?? status
  );
}

/** Dados prontos da etiqueta de lote (impressão). */
export function batchLabelData(input: {
  productName: string;
  sku: string;
  barcode: string | null;
  batchNumber: string;
  expiresAt: string | null;
  quantity: number;
}): BatchLabel {
  return {
    productName: input.productName,
    batchNumber: input.batchNumber,
    expiresText: input.expiresAt ? fmtDateBr(input.expiresAt) : "—",
    code: input.barcode?.trim() || input.sku,
    quantityText: String(input.quantity).replace(".", ","),
  };
}

/** Consolida o rastreio: entradas, saídas, saldo aparente, vendas, clientes. */
export function summarizeTrace(movements: readonly TraceMovement[]): TraceSummary {
  let entradas = 0;
  let saidas = 0;
  const clientes = new Set<string>();
  let vendas = 0;

  for (const m of movements) {
    if (m.type.startsWith(ENTRADA_PREFIX)) {
      entradas += m.quantity;
    } else {
      saidas += m.quantity;
    }
    if (m.saleId) {
      vendas += 1;
      if (m.customerName) clientes.add(m.customerName);
    }
  }

  return {
    entradas,
    saidas,
    saldo: entradas - saidas,
    vendas,
    clientes: [...clientes].sort(),
  };
}
