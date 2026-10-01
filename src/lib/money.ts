// Dinheiro em CENTAVOS (integer) — regra do AGENTS.md: nunca float.
export function toCents(value: string | number): number {
  if (typeof value === "number") return Math.round(value * 100);
  const s = value.trim();
  // "1.234,56" (pt-BR) ou "1234.56" (banco/inglês)
  const n = s.includes(",")
    ? parseFloat(s.replace(/\./g, "").replace(",", "."))
    : parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`Valor monetário inválido: ${value}`);
  return Math.round(n * 100);
}

/** 1100 → "11.00" (formato do banco numeric(14,2)) */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 1100 → "R$ 11,00" */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatCents(cents: number): string {
  return fromCents(cents);
}
