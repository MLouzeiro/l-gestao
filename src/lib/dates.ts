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

/** Data local de hoje em `YYYY-MM-DD` (default de inputs <input type="date">). */
export function todayInputValue(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Coluna date (UTC midnight) → "YYYY-MM-DD" para <input type="date">. */
export function dateOnlyInput(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}
