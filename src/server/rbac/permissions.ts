import { permissionCatalog } from "@/server/db/schema";

// Matriz papel → permissões (regra de negócio — tests/unit/rbac.test.ts).
// Papéis-sistema: src/server/db/schema/rbac.ts (systemRoles).

const CATALOG_KEYS = permissionCatalog.map((p) => p.key);

const viewOnly = permissionCatalog
  .filter((p) => p.key.endsWith(".view"))
  .map((p) => p.key);

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  ADMIN: CATALOG_KEYS,
  GERENTE: [
    "products.view",
    "products.manage",
    "stock.view",
    "stock.manage",
    "stock.transfer",
    "stock.inventory",
    "purchases.view",
    "purchases.manage",
    "sales.view",
    "sales.manage",
    "sales.discount",
    "sales.billing",
    "finance.view",
    "finance.manage",
    "finance.payments",
    "users.view",
    "reports.view",
    "audit.view",
    "units.view",
    "units.manage",
  ],
  FINANCEIRO: [
    "products.view",
    "stock.view",
    "purchases.view",
    "sales.view",
    "sales.billing",
    "finance.view",
    "finance.manage",
    "finance.payments",
    "reports.view",
    "units.view",
  ],
  ESTOQUISTA: [
    "products.view",
    "products.manage",
    "stock.view",
    "stock.manage",
    "stock.transfer",
    "stock.inventory",
    "purchases.view",
    "purchases.manage",
    "sales.view",
    "units.view",
    "units.manage",
  ],
  VENDEDOR: [
    "products.view",
    "stock.view",
    "sales.view",
    "sales.manage",
    "sales.discount",
  ],
  VISUALIZADOR: viewOnly,
};

export function resolvePermissions(role: string): readonly string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Recusa de RBAC no servidor (a Action responde com 403, não 500). */
export class PermissionError extends Error {
  readonly status = 403;
  constructor(permission: string) {
    super(`Sem permissão: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Guarda pura usada pelas Server Actions (tests/integration/sale.test.ts). */
export function assertPermission(role: string, permission: string): void {
  if (!resolvePermissions(role).includes(permission)) {
    throw new PermissionError(permission);
  }
}
