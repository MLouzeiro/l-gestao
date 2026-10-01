import { canChangeRole, canRemoveMember } from "@/server/rbac/admin-rules";

const admin = { userId: "u-admin", role: "ADMIN" };
const gerente = { userId: "u-gerente", role: "GERENTE" };
const vendedor = { userId: "u-vendedor", role: "VENDEDOR" };

describe("Regra do último ADMIN (M1)", () => {
  it("não permite REMOVER o único ADMIN do tenant", () => {
    const r = canRemoveMember([admin, vendedor], "u-admin");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain("administrador");
  });

  it("não permite REBAIXAR o único ADMIN do tenant", () => {
    const r = canChangeRole([admin, vendedor], "u-admin", "GERENTE");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain("administrador");
  });

  it("permite remover/rebaixar ADMIN quando existe outro ADMIN", () => {
    const dois = [
      admin,
      { userId: "u-admin2", role: "ADMIN" },
      vendedor,
    ];
    expect(canRemoveMember(dois, "u-admin").ok).toBe(true);
    expect(canChangeRole(dois, "u-admin", "VENDEDOR").ok).toBe(true);
  });

  it("permite remover membros que não são ADMIN", () => {
    expect(canRemoveMember([admin, vendedor], "u-vendedor").ok).toBe(true);
    expect(canRemoveMember([admin, gerente], "u-gerente").ok).toBe(true);
  });

  it("permite promover qualquer membro a ADMIN", () => {
    expect(canChangeRole([admin, vendedor], "u-vendedor", "ADMIN").ok).toBe(
      true,
    );
  });

  it("membro inexistente é recusado", () => {
    expect(canRemoveMember([admin], "u-fantasma").ok).toBe(false);
    expect(canChangeRole([admin], "u-fantasma", "ADMIN").ok).toBe(false);
  });

  it("troca para o mesmo papel é permitida (no-op)", () => {
    expect(canChangeRole([admin, gerente], "u-gerente", "GERENTE").ok).toBe(
      true,
    );
  });
});
