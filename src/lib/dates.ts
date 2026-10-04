// Datas de colunas `date` (gravadas como UTC midnight pelo Drizzle) saem SEMPRE
// pelos getters UTC — o relógio local é UTC-3 e mudaria o dia (regra da Fase 11).

/** "2026-10-01" (coluna date) → "01/10/2026". */
export function formatDateOnly(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

/** Timestamp (timestamptz) → "01/10/2026 14:30" no horário local. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Chave de dia local (relógio de parede) de um timestamp: "YYYY-MM-DD". */
export function localDayKey(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Início do dia de negócio local ("YYYY-MM-DD" → meia-noite no relógio local).
 * Usado como limite inferior de filtros sobre timestamptz (ex.: billedAt).
 */
export function localDayStart(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
}

/** Fim do dia de negócio local (23:59:59.999 no relógio local). */
export function localDayEnd(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999);
}

/** Data local de hoje em `YYYY-MM-DD` (default de inputs <input type="date">). */
export function todayInputValue(): string {
  return localDayKey(new Date());
}

/** Coluna date (UTC midnight) → "YYYY-MM-DD" para <input type="date">. */
export function dateOnlyInput(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}
