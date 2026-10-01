import {
  ROLE_PERMISSIONS,
  resolvePermissions,
} from "@/server/rbac/permissions";
import { permissionCatalog, systemRoles } from "@/server/db/schema";

describe("RBAC — matriz papel → permissões", () => {
  it("ADMIN recebe todas as permissões do catálogo", () => {
    const perms = resolvePermissions("ADMIN");
    expect(perms).toHaveLength(permissionCatalog.length);
    expect(perms).toContain("settings.manage");
    expect(perms).toContain("users.manage");
  });

  it("VENDEDOR gerencia vendas, mas não acessa usuários, estoque ou configurações", () => {
    const perms = resolvePermissions("VENDEDOR");
    expect(perms).toContain("sales.manage");
    expect(perms).toContain("sales.discount");
    expect(perms).toContain("products.view");
    expect(perms).not.toContain("users.manage");
    expect(perms).not.toContain("stock.manage");
    expect(perms).not.toContain("settings.manage");
    expect(perms).not.toContain("finance.manage");
  });

  it("VISUALIZADOR só tem permissões de leitura (*.view)", () => {
    const perms = resolvePermissions("VISUALIZADOR");
    expect(perms.length).toBeGreaterThan(0);
    for (const key of perms) {
      expect(key).toMatch(/\.view$/);
    }
  });

  it("GERENTE gerencia a operação, mas não gerencia usuários nem configurações", () => {
    const perms = resolvePermissions("GERENTE");
    expect(perms).toContain("stock.manage");
    expect(perms).toContain("sales.manage");
    expect(perms).toContain("users.view");
    expect(perms).not.toContain("users.manage");
    expect(perms).not.toContain("settings.manage");
  });

  it("papel desconhecido não recebe nenhuma permissão", () => {
    expect(resolvePermissions("QUALQUER_COISA")).toEqual([]);
    expect(resolvePermissions("")).toEqual([]);
  });

  it("toda permissão referenciada existe no catálogo e todo papel-sistema tem matriz", () => {
    const catalogKeys = new Set<string>(
      permissionCatalog.map((p) => p.key),
    );
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const key of perms) {
        expect(catalogKeys.has(key)).toBe(true);
      }
    }
    for (const role of systemRoles) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role]!.length).toBeGreaterThan(0);
    }
  });
});
