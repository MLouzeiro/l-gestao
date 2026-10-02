// Payload PIX (BR Code — EMV® QRCPS-MPM) + CRC-16/CCITT-FALSE.
// Valores sempre em centavos (regra do AGENTS.md: nunca float).
// Reaproveitado do l-estoque (PixPayload) — portado p/ TS com testes.

export type PixPayloadInput = {
  key: string;
  name: string;
  city: string;
  txid?: string | null;
  amountCents: number;
};

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — hex uppercase 4 chars. */
export function crc16(input: string): string {
  let crc = 0xffff;
  const poly = 0x1021;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Normaliza a chave: celular → +55..., CNPJ/CPF → só dígitos, e-mail/aleatória → à toa. */
export function normalizePixKey(key: string): string {
  const c = key.trim();
  if (!c) return "";
  if (c.includes("@")) return c;
  if (c.length > 30 && Number.isNaN(Number(c.replace(/-/g, "")))) return c;
  const n = c.replace(/\D/g, "");
  if (n.length === 14) return n;
  if (n.length === 11) return n[2] === "9" ? `+55${n}` : n;
  if (n.length >= 10 && n.length < 12) return `+55${n}`;
  return c;
}

function cleanText(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "-")
    .slice(0, max);
}

function field(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/**
 * Gera o payload copia-e-cola (com CRC). Sem chave ou sem valor → string
 * vazia (cobrança sem valor livre não tem QR fixo).
 */
export function buildPixPayload(input: PixPayloadInput): string {
  const key = normalizePixKey(input.key);
  const value =
    input.amountCents > 0 ? (input.amountCents / 100).toFixed(2) : "";
  if (!key || !value) return "";

  const txid =
    cleanText(input.txid?.trim() || "***", 25).replace(/[^\x20-\x7E]/g, "") ||
    "***";
  const name = cleanText(input.name || "Recebedor", 25) || "Recebedor";
  const city = cleanText(input.city || "Cidade", 15) || "Cidade";

  const gui = field("00", "BR.GOV.BCB.PIX") + field("01", key);
  const body = [
    field("00", "01"),
    field("26", gui),
    field("52", "0000"),
    field("53", "986"),
    field("54", value),
    field("58", "BR"),
    field("59", name),
    field("60", city),
    field("62", field("05", txid)),
    "6304",
  ].join("");
  return body + crc16(body);
}
