// Regras puras de transferências entre unidades (E4+E6) — sem banco.
// Workflow DRAFT → SENT → RECEIVED / CANCELLED + modo de baixa (settle_on).

export type TransferStatus = "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED";
export type TransferSettleOn = "SEND" | "RECEIVE";
export type TransferAction = "send" | "receive" | "cancel";

export type TransferItemInput = {
  productId: string;
  batchNumber?: string | null;
  quantity: number;
};

/** Erro de domínio com mensagem pt-BR (a action devolve como { error }). */
export class TransferError extends Error {}

export const TRANSFER_NUMBER_PREFIX = "TRANSF";
export const TRANSFER_NUMBER_WIDTH = 6;
const MAX_ITEMS = 200;

/** 1 → "TRANSF-000001" (não inteiro é truncado). */
export function formatTransferNumber(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  return `${TRANSFER_NUMBER_PREFIX}-${String(n).padStart(TRANSFER_NUMBER_WIDTH, "0")}`;
}

const TRANSITIONS: Record<TransferStatus, TransferAction[]> = {
  DRAFT: ["send", "cancel"],
  SENT: ["receive", "cancel"],
  RECEIVED: [],
  CANCELLED: [],
};

/** Valida a transição de estado da transferência. */
export function assertTransferTransition(
  status: TransferStatus,
  action: TransferAction,
): void {
  if (!TRANSITIONS[status].includes(action)) {
    if (status === "DRAFT" && action === "receive") {
      throw new TransferError(
        "A transferência precisa ser enviada antes de receber.",
      );
    }
    throw new TransferError(
      `Transferência ${statusLabel(status)} não pode ser ${actionLabel(action)}.`,
    );
  }
}

function statusLabel(status: TransferStatus): string {
  return (
    {
      DRAFT: "em rascunho",
      SENT: "enviada",
      RECEIVED: "recebida",
      CANCELLED: "cancelada",
    }[status] ?? status
  );
}

function actionLabel(action: TransferAction): string {
  return (
    {
      send: "enviada",
      receive: "recebida",
      cancel: "cancelada",
    }[action] ?? action
  );
}

/**
 * Valida os itens: lista não vazia, quantidade > 0, sem produto duplicado
 * (uma linha por produto — lote opcional) e limite de 200 itens.
 */
export function assertTransferItems(items: readonly TransferItemInput[]): void {
  if (items.length === 0) {
    throw new TransferError("A transferência precisa de ao menos um item.");
  }
  if (items.length > MAX_ITEMS) {
    throw new TransferError(`Máximo de ${MAX_ITEMS} itens por transferência.`);
  }
  const seen = new Set<string>();
  for (const it of items) {
    if (!(it.quantity > 0)) {
      throw new TransferError("A quantidade de cada item deve ser maior que zero.");
    }
    if (seen.has(it.productId)) {
      throw new TransferError("Item duplicado na transferência.");
    }
    seen.add(it.productId);
  }
}

/**
 * A baixa na origem acontece no envio (SEND) ou só no recebimento (RECEIVE).
 * RECEIVE mantém o saldo na origem enquanto o material está em trânsito.
 */
export function shouldReleaseOnSend(settleOn: TransferSettleOn): boolean {
  return settleOn === "SEND";
}

/** Valor total do item em centavos (custo unitário × quantidade). */
export function calcTransferCostCents(
  unitCostCents: number,
  quantity: number,
): number {
  return Math.round(unitCostCents * quantity);
}
