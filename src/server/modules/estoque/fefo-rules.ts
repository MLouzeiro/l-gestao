// Regras puras de FEFO (First Expired, First Out) — TDD:
// tests/unit/fefo-rules.test.ts. Sem banco: datas em "YYYY-MM-DD"
// (comparação lexicográfica = cronológica para o mesmo formato).

export type FefoLote = {
  batchNumber: string;
  /** "YYYY-MM-DD" ou null (produto sem controle de validade) */
  expiresAt: string | null;
  /** ISO — entrada mais antiga desempata */
  createdAt: string;
  /** saldo físico disponível no depósito */
  available: number;
};

export type FefoOptions = {
  /** tenant_settings.bloqueio_venda_vencido */
  bloqueioVencido: boolean;
  /** "YYYY-MM-DD" — default: dia local atual */
  hoje?: string;
};

export type FefoPlan =
  | { ok: true; batchNumber: string }
  | { ok: false; reason: string };

export function hojeYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Vencido = validade estritamente anterior ao dia de hoje (no dia ainda vale). */
export function isBatchExpired(
  expiresAt: string | null,
  hoje: string = hojeYmd(),
): boolean {
  if (!expiresAt) return false;
  return expiresAt < hoje;
}

/** Ordena para FEFO: vencidos/mais próximos primeiro; sem validade por último;
 *  empate na validade → entrada mais antiga primeiro. Não muta a lista. */
export function sortFefo<T extends Pick<FefoLote, "expiresAt" | "createdAt">>(
  lotes: readonly T[],
): T[] {
  return [...lotes].sort((a, b) => {
    if (a.expiresAt !== b.expiresAt) {
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt < b.expiresAt ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * Escolhe o lote de uma SAÍDA (um lote por movimento — modelo atual).
 * - `bloqueioVencido`: lotes vencidos saem da disputa; se sobrar só vencido,
 *   o motivo explica (regra: lote vencido bloqueado pela configuração).
 * - Caso contrário: o vencido é o próprio FEFO e sai primeiro.
 * - Considera apenas lotes com saldo suficiente (fila FEFO).
 */
export function selectFefoBatch(
  lotes: readonly FefoLote[],
  quantity: number,
  opts: FefoOptions,
): FefoPlan {
  const hoje = opts.hoje ?? hojeYmd();
  const comSaldo = lotes.filter((l) => l.available >= quantity);

  if (comSaldo.length === 0) {
    const comQualquerSaldo = lotes.filter((l) => l.available > 0);
    if (comQualquerSaldo.length > 0) {
      const max = Math.max(...comQualquerSaldo.map((l) => l.available));
      return {
        ok: false,
        reason:
          `Saldo insuficiente nos lotes: a maior quantidade disponível em um ` +
          `único lote é ${max} (não é possível fatiar a saída entre lotes).`,
      };
    }
    return { ok: false, reason: "Nenhum lote com saldo disponível." };
  }

  const elegiveis = opts.bloqueioVencido
    ? comSaldo.filter((l) => !isBatchExpired(l.expiresAt, hoje))
    : comSaldo;

  if (elegiveis.length === 0) {
    return {
      ok: false,
      reason:
        "Lote vencido: a venda está bloqueada pela configuração " +
        "(bloqueio_venda_vencido).",
    };
  }

  const escolhido = sortFefo(elegiveis)[0];
  return { ok: true, batchNumber: escolhido.batchNumber };
}
