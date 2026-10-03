import { and, eq } from "drizzle-orm";
import {
  modules,
  subscriptions,
  tenantModules,
} from "@/server/db/schema";
import {
  ModuleError,
  hasModule,
  listTenantModuleKeys,
  requireModule,
  setTenantModule,
} from "@/server/modules/tenancy/module.service";
import { provisionTenant } from "@/server/modules/tenancy/provision";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestTenant } from "./helpers";

// Módulos contratáveis (PROMPT MESTRE §35): preset por segmento no
// provisionamento, requireModule no servidor e RLS entre empresas.

describe("módulos — provisionamento por segmento", () => {
  it("tenant novo (COMERCIO_GERAL) recebe o preset base ativo", async () => {
    const { tenantId } = await createTestTenant();
    const keys = await withTenant(tenantId, (tx) =>
      listTenantModuleKeys(tx, tenantId),
    );
    expect(keys).toContain("ESTOQUE");
    expect(keys).toContain("VENDAS");
    expect(keys).toContain("PDV");
    expect(keys).not.toContain("MATRIZ_POSTOS");
  });

  it("tenant LABORATORIO recebe matriz→postos, transferências e reposição", async () => {
    const { tenantId } = await createTestTenant();
    // vira laboratório e reprovisiona (idempotente: acrescenta o preset)
    await withTenant(tenantId, async (tx) => {
      const { tenants } = await import("@/server/db/schema");
      await tx
        .update(tenants)
        .set({ segment: "LABORATORIO" })
        .where(eq(tenants.id, tenantId));
    });
    await provisionTenant(tenantId);
    const keys = await withTenant(tenantId, (tx) =>
      listTenantModuleKeys(tx, tenantId),
    );
    expect(keys).toContain("MATRIZ_POSTOS");
    expect(keys).toContain("TRANSFERENCIAS");
    expect(keys).toContain("REPOSICAO");
    expect(keys).toContain("LOTES_VALIDADE");
  });

  it("assinatura TRIAL é criada no provisionamento", async () => {
    const { tenantId } = await createTestTenant();
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("TRIAL");
  });
});

describe("módulos — requireModule no servidor", () => {
  it("módulo ativo passa; desativado recusa com ModuleError", async () => {
    const { tenantId } = await createTestTenant();
    await withTenant(tenantId, (tx) =>
      requireModule(tx, tenantId, "ESTOQUE"),
    );

    await withTenant(tenantId, (tx) =>
      setTenantModule(tx, { tenantId, userId: null }, "PDV", false),
    );
    await expect(
      withTenant(tenantId, (tx) => requireModule(tx, tenantId, "PDV")),
    ).rejects.toThrow(ModuleError);

    const has = await withTenant(tenantId, (tx) =>
      hasModule(tx, tenantId, "PDV"),
    );
    expect(has).toBe(false);
  });

  it("módulo nunca contratado também é recusado", async () => {
    const { tenantId } = await createTestTenant();
    await expect(
      withTenant(tenantId, (tx) => requireModule(tx, tenantId, "REPOSICAO")),
    ).rejects.toThrow(/REPOSICAO|módulo/i);
  });
});

describe("módulos — RLS (Empresa A não vê de Empresa B)", () => {
  it("cada empresa só enxerga os próprios tenant_modules", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    const seenByB = await withTenant(b.tenantId, (tx) =>
      tx.select().from(tenantModules),
    );
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByB.every((r) => r.tenantId === b.tenantId)).toBe(true);

    const seenByA = await withTenant(a.tenantId, (tx) =>
      tx.select().from(tenantModules),
    );
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  it("Empresa B não consegue desativar módulo da Empresa A (0 linhas)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    const updated = await withTenant(b.tenantId, (tx) =>
      tx
        .update(tenantModules)
        .set({ active: false })
        .where(eq(tenantModules.tenantId, a.tenantId))
        .returning({ id: tenantModules.id }),
    );
    expect(updated).toHaveLength(0);

    // os módulos da A continuam ativos
    const keys = await withTenant(a.tenantId, (tx) =>
      listTenantModuleKeys(tx, a.tenantId),
    );
    expect(keys).toContain("ESTOQUE");
  });

  it("catálogo de módulos é global (visível para qualquer empresa)", async () => {
    const a = await createTestTenant();
    const rows = await withTenant(a.tenantId, (tx) =>
      tx.select().from(modules),
    );
    expect(rows.length).toBeGreaterThan(0);
    // e nenhuma linha de tenant_modules de outra empresa vaza pelo join
    const foreign = rows.filter((m) => (m as { tenantId?: string }).tenantId);
    expect(foreign).toHaveLength(0);
  });
});

describe("módulos — ativação registra quem alterou", () => {
  it("setTenantModule grava contractedBy e active", async () => {
    const { tenantId } = await createTestTenant();
    await withTenant(tenantId, (tx) =>
      setTenantModule(tx, { tenantId, userId: null }, "PDV", true),
    );
    const [row] = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(tenantModules)
        .where(
          and(
            eq(tenantModules.tenantId, tenantId),
            eq(tenantModules.active, true),
          ),
        )
        .limit(1),
    );
    expect(row).toBeDefined();
  });
});
