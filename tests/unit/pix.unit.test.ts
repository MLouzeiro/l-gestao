import {
  buildPixPayload,
  crc16,
  normalizePixKey,
} from "@/lib/pix";

// Payload PIX (BR Code / EMV® QRCPS-MPM) + CRC-16/CCITT-FALSE.
// Vetor conhecido do CRC: "123456789" → 0x29B1.

describe("crc16", () => {
  it("vetor conhecido CRC-16/CCITT-FALSE: '123456789' → 29B1", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("sempre 4 hex uppercase", () => {
    const c = crc16("payload qualquer");
    expect(c).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("normalizePixKey", () => {
  it("telefone 11 dígitos vira +55...", () => {
    expect(normalizePixKey("85999998888")).toBe("+5585999998888");
    expect(normalizePixKey("(85) 99999-8888")).toBe("+5585999998888");
    expect(normalizePixKey("+5585999998888")).toBe("+5585999998888");
  });

  it("CNPJ 14 dígitos fica só com números", () => {
    expect(normalizePixKey("12.345.678/0001-90")).toBe("12345678000190");
  });

  it("e-mail e chave aleatória passam adiante", () => {
    expect(normalizePixKey("loja@exemplo.com")).toBe("loja@exemplo.com");
    expect(normalizePixKey("a1b2c3d4-1234-4abc-9def-000000000000")).toBe(
      "a1b2c3d4-1234-4abc-9def-000000000000",
    );
  });

  it("vazio vira string vazia", () => {
    expect(normalizePixKey("   ")).toBe("");
  });
});

describe("buildPixPayload", () => {
  const input = {
    key: "85999998888",
    name: "Lanchonete Sao Joao",
    city: "FORTALEZA",
    txid: "PDV1234",
    amountCents: 12345,
  };

  it("payload começa com 000201, traz o gui do pix e o valor em reais", () => {
    const p = buildPixPayload(input);
    expect(p.startsWith("000201")).toBe(true);
    expect(p).toContain("BR.GOV.BCB.PIX");
    expect(p).toContain("5406123.45");
    expect(p).toContain("+5585999998888");
  });

  it("termina em 6304 + CRC válido (recomputa igual)", () => {
    const p = buildPixPayload(input);
    const crc = p.slice(-4);
    const body = p.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(crc).toBe(crc16(body));
  });

  it("sem valor: payload vazio (cobrança sem valor livre)", () => {
    expect(
      buildPixPayload({ ...input, amountCents: 0 }),
    ).toBe("");
    expect(
      buildPixPayload({ ...input, amountCents: 0, key: "" }),
    ).toBe("");
  });

  it("payload 100% ASCII: acentos removidos e não-ASCII viram hífen", () => {
    const p = buildPixPayload({
      ...input,
      name: "Café & Cia — São João da Serra",
      city: "São Paulo",
    });
    expect(p).toContain("Cafe & Cia");
    expect(p).toContain("Sao Paulo");
    expect(p).not.toMatch(/[^\x20-\x7E]/);
  });
});
