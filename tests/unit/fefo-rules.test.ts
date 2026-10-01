import {
  isBatchExpired,
  selectFefoBatch,
  sortFefo,
} from "@/server/modules/estoque/fefo-rules";

// Críticos do AGENTS.md:
// - "Venda usa lote FEFO quando controle_fefo ativo"
// - "Lote vencido é bloqueado quando bloqueio_venda_vencido ativo"
// Regras puras: sem banco, datas em "YYYY-MM-DD" (comparação lexicográfica).

const HOJE = "2026-09-27";

describe("isBatchExpired", () => {
  it("vencido quando a validade é anterior ao dia de hoje", () => {
    expect(isBatchExpired("2026-09-26", HOJE)).toBe(true);
    expect(isBatchExpired("2026-01-01", HOJE)).toBe(true);
  });

  it("vale no dia da validade e depois", () => {
    expect(isBatchExpired("2026-09-27", HOJE)).toBe(false);
    expect(isBatchExpired("2026-09-28", HOJE)).toBe(false);
    expect(isBatchExpired("2027-12-31", HOJE)).toBe(false);
  });

  it("sem validade nunca está vencido", () => {
    expect(isBatchExpired(null, HOJE)).toBe(false);
  });
});

describe("sortFefo (First Expired, First Out)", () => {
  it("ordena por validade crescente — vencido primeiro", () => {
    const lotes = [
      { batchNumber: "B", expiresAt: "2027-06-30", createdAt: "2026-01-02" },
      { batchNumber: "A", expiresAt: "2026-01-01", createdAt: "2026-01-03" },
      { batchNumber: "C", expiresAt: "2026-10-31", createdAt: "2026-01-01" },
    ];
    expect(sortFefo(lotes).map((l) => l.batchNumber)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("lotes sem validade vão para o fim", () => {
    const lotes = [
      { batchNumber: "N", expiresAt: null, createdAt: "2026-01-01" },
      { batchNumber: "B", expiresAt: "2027-01-01", createdAt: "2026-01-01" },
      { batchNumber: "A", expiresAt: "2026-12-01", createdAt: "2026-01-01" },
    ];
    expect(sortFefo(lotes).map((l) => l.batchNumber)).toEqual([
      "A",
      "B",
      "N",
    ]);
  });

  it("desempata na mesma validade pela entrada mais antiga", () => {
    const lotes = [
      { batchNumber: "novo", expiresAt: "2027-01-01", createdAt: "2026-05-01" },
      { batchNumber: "antigo", expiresAt: "2027-01-01", createdAt: "2026-01-01" },
    ];
    expect(sortFefo(lotes).map((l) => l.batchNumber)).toEqual([
      "antigo",
      "novo",
    ]);
  });
});

describe("selectFefoBatch (auto-alocação de saída)", () => {
  const base = {
    batchNumber: "L1",
    expiresAt: "2027-06-30",
    createdAt: "2026-01-01",
    available: 10,
  };

  it("sem lotes → erro", () => {
    const r = selectFefoBatch([], 5, { bloqueioVencido: false, hoje: HOJE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/lote/i);
  });

  it("saldo 0 não é candidato → erro de saldo", () => {
    const r = selectFefoBatch(
      [{ ...base, available: 0 }],
      5,
      { bloqueioVencido: false, hoje: HOJE },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/insuficiente|disponível/i);
  });

  it("escolhe o lote de validade mais próxima (FEFO)", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "FUTURO", expiresAt: "2027-12-31" },
        { ...base, batchNumber: "PERTO", expiresAt: "2026-10-31" },
        { ...base, batchNumber: "SEM-VAL", expiresAt: null },
      ],
      5,
      { bloqueioVencido: false, hoje: HOJE },
    );
    expect(r).toEqual({ ok: true, batchNumber: "PERTO" });
  });

  it("salta lote sem saldo suficiente e usa o próximo da fila FEFO", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "POUCO", expiresAt: "2026-10-31", available: 3 },
        { ...base, batchNumber: "MUITO", expiresAt: "2027-12-31", available: 20 },
      ],
      5,
      { bloqueioVencido: false, hoje: HOJE },
    );
    expect(r).toEqual({ ok: true, batchNumber: "MUITO" });
  });

  it("nenhum lote com saldo suficiente → erro insuficiente", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "P1", expiresAt: "2026-10-31", available: 3 },
        { ...base, batchNumber: "P2", expiresAt: "2027-12-31", available: 4 },
      ],
      5,
      { bloqueioVencido: false, hoje: HOJE },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/insuficiente/i);
  });

  it("sem bloqueio: FEFO usa o lote vencido primeiro", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "VENC", expiresAt: "2026-01-01", available: 10 },
        { ...base, batchNumber: "OK", expiresAt: "2027-06-30", available: 10 },
      ],
      5,
      { bloqueioVencido: false, hoje: HOJE },
    );
    expect(r).toEqual({ ok: true, batchNumber: "VENC" });
  });

  it("com bloqueio: FEFO pula o lote vencido", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "VENC", expiresAt: "2026-01-01", available: 10 },
        { ...base, batchNumber: "OK", expiresAt: "2027-06-30", available: 10 },
      ],
      5,
      { bloqueioVencido: true, hoje: HOJE },
    );
    expect(r).toEqual({ ok: true, batchNumber: "OK" });
  });

  it("com bloqueio e só lotes vencidos → erro mencionando vencido", () => {
    const r = selectFefoBatch(
      [
        { ...base, batchNumber: "V1", expiresAt: "2026-01-01", available: 10 },
        { ...base, batchNumber: "V2", expiresAt: "2026-05-01", available: 10 },
      ],
      5,
      { bloqueioVencido: true, hoje: HOJE },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vencido/i);
  });
});
