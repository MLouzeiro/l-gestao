// Regras puras de inventário (TDD: tests/unit/inventory-rules.test.ts).
// Nenhum acesso a banco aqui — só validação da contagem e plano de ajustes.
// Regra crítica (AGENTS.md): contagem 8 vs sistema 10 → ajuste 2.

export type CountItem = {
  /** identificador do item no inventário (opcional, só para mensagens) */
  itemId?: string;
  productId: string;
  /** null = produto sem controle de lote */
  batchNumber?: string | null;
  /** saldo do sistema no momento da abertura do inventário */
  systemQty: number;
  /** null/undefined = ainda não contado */
  countedQty?: number | null;
};

export type InventoryAdjustment = {
  productId: string;
  batchNumber: string | null;
  /** contado − sistema (negativo = falta, positivo = ganho) */
  difference: number;
  /** magnitude a movimentar (> 0) */
  quantity: number;
  direction: "ENTRADA" | "SAIDA";
};

export type InventoryPlan =
  | {
      ok: true;
      adjustments: InventoryAdjustment[];
      /** itens ainda sem contagem — bloqueiam a aplicação */
      pending: number;
      /** itens com diferença (ajustes gerados) */
      changed: number;
    }
  | { ok: false; reason: string };

function isCounted(v: number | null | undefined): v is number {
  return typeof v === "number";
}

/**
 * Converte a contagem em plano de ajustes:
 * - diferença > 0 → ENTRADA (sobra no físico)
 * - diferença < 0 → SAIDA (falta no físico)
 * - diferença = 0 → nada
 * - não contado → pendente (bloqueia a aplicação)
 */
export function planInventoryAdjustments(
  items: readonly CountItem[],
): InventoryPlan {
  const adjustments: InventoryAdjustment[] = [];
  const seen = new Set<string>();
  let pending = 0;
  let changed = 0;

  for (const it of items) {
    const batchNumber = it.batchNumber ?? null;
    const key = `${it.productId}::${batchNumber ?? ""}`;

    if (seen.has(key)) {
      const lote = batchNumber ? ` (lote ${batchNumber})` : "";
      return {
        ok: false,
        reason: `Item duplicado no inventário: produto ${it.productId}${lote}.`,
      };
    }
    seen.add(key);

    if (!Number.isFinite(it.systemQty) || it.systemQty < 0) {
      return {
        ok: false,
        reason: `Item com saldo do sistema inválido: produto ${it.productId}.`,
      };
    }

    if (!isCounted(it.countedQty)) {
      pending += 1;
      continue;
    }
    if (!Number.isFinite(it.countedQty) || it.countedQty < 0) {
      return {
        ok: false,
        reason: `Contagem inválida (negativa ou não numérica) para o produto ${it.productId}.`,
      };
    }

    const difference = round3(it.countedQty - it.systemQty);
    if (difference === 0) continue;

    changed += 1;
    adjustments.push({
      productId: it.productId,
      batchNumber,
      difference,
      quantity: round3(Math.abs(difference)),
      direction: difference > 0 ? "ENTRADA" : "SAIDA",
    });
  }

  return { ok: true, adjustments, pending, changed };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
