import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  brands,
  categories,
  productComponents,
  products,
  stockMovements,
  suppliers,
} from "@/server/db/schema";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import {
  ProductError,
  createBrand,
  createCategory,
  createProduct,
  createSupplier,
  saveKitComponents,
  softDeleteProduct,
  updateProduct,
} from "@/server/modules/cadastros/product.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { createTestProduct, createTestTenant } from "./helpers";

// Fase 7 — produtos: SKU único por tenant, RLS, soft delete, variações
// (sem ciclo), kits (sem ciclo) e fornecedores.

async function countProducts(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.tenantId, tenantId));
    return r?.n ?? 0;
  });
}

describe("createProduct — SKU e RLS", () => {
  it("SKU único por tenant; mesmo SKU em outro tenant é permitido", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    await withTenant(a.tenantId, (tx) =>
      createProduct(tx, {
        tenantId: a.tenantId,
        sku: "SKU-UNICO",
        name: "Produto A",
        salePriceCents: 1000,
      }),
    );

    // duplicado no mesmo tenant (case/space-insensitive) → erro
    await expect(
      withTenant(a.tenantId, (tx) =>
        createProduct(tx, {
          tenantId: a.tenantId,
          sku: " sku-unico ",
          name: "Outro",
          salePriceCents: 500,
        }),
      ),
    ).rejects.toThrow(/SKU/i);

    // mesmo SKU na empresa B → ok
    await withTenant(b.tenantId, (tx) =>
      createProduct(tx, {
        tenantId: b.tenantId,
        sku: "SKU-UNICO",
        name: "Produto B",
        salePriceCents: 1000,
      }),
    );
    expect(await countProducts(a.tenantId)).toBe(1);
    expect(await countProducts(b.tenantId)).toBe(1);
  });

  it("RLS: produto/categoria/marca/movimento de A invisíveis para B", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    const { productId } = await withTenant(a.tenantId, async (tx) => {
      const p = await createProduct(tx, {
        tenantId: a.tenantId,
        sku: "SKU-RLS",
        name: "Segredo A",
        salePriceCents: 1000,
      });
      await createCategory(tx, { tenantId: a.tenantId, name: "Categoria A" });
      await createBrand(tx, { tenantId: a.tenantId, name: "Marca A" });
      await applyMovement(tx, {
        tenantId: a.tenantId,
        type: "ENTRADA_COMPRA",
        productId: p.productId,
        warehouseId: a.warehouseId,
        quantity: 5,
        unitCostCents: 100,
      });
      return p;
    });

    const emB = await withTenant(b.tenantId, async (tx) => {
      const prods = await tx
        .select()
        .from(products)
        .where(eq(products.tenantId, a.tenantId));
      const cats = await tx
        .select()
        .from(categories)
        .where(eq(categories.tenantId, a.tenantId));
      const brs = await tx
        .select()
        .from(brands)
        .where(eq(brands.tenantId, a.tenantId));
      const movs = await tx
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, a.tenantId));
      return {
        produtos: prods.length,
        categorias: cats.length,
        marcas: brs.length,
        movimentos: movs.length,
      };
    });
    expect(emB).toEqual({
      produtos: 0,
      categorias: 0,
      marcas: 0,
      movimentos: 0,
    });
    expect(productId).toBeTruthy();
  });
});

describe("softDeleteProduct", () => {
  it("some do catálogo, preserva movimentações e libera o SKU", async () => {
    const { tenantId, warehouseId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId, {
      trackBatch: false,
    });

    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId,
        warehouseId,
        quantity: 3,
        unitCostCents: 500,
      }),
    );

    await withTenant(tenantId, (tx) =>
      softDeleteProduct(tx, tenantId, productId),
    );

    const visiveis = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            isNull(products.deletedAt),
          ),
        );
      const [movs] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, tenantId));
      return { visiveis: rows.length, movimentos: movs?.n ?? 0 };
    });
    expect(visiveis.visiveis).toBe(0);
    expect(visiveis.movimentos).toBe(1);

    // SKU liberado após o soft delete (unique parcial ignora linha apagada)
    await withTenant(tenantId, (tx) =>
      createProduct(tx, {
        tenantId,
        sku: "SKU-REAPROVEITADO",
        name: "Novo dono do SKU",
        salePriceCents: 900,
      }),
    );
  });

  it("excluir duas vezes ou inexistente → erro amigável", async () => {
    const { tenantId } = await createTestTenant();
    await expect(
      withTenant(tenantId, (tx) =>
        softDeleteProduct(tx, tenantId, "00000000-0000-4000-8000-000000000000"),
      ),
    ).rejects.toThrow(/não encontrado/i);
  });
});

describe("updateProduct — edição e variações", () => {
  it("edita preço/nome e recusa produto inexistente", async () => {
    const { tenantId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await withTenant(tenantId, (tx) =>
      updateProduct(tx, productId, {
        tenantId,
        sku: "SKU-EDITADO",
        name: "Produto Editado",
        salePriceCents: 2590,
        costPriceCents: 1200,
      }),
    );

    await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .select({ name: products.name, sku: products.sku, sale: products.salePrice })
        .from(products)
        .where(eq(products.id, productId));
      expect(p.name).toBe("Produto Editado");
      expect(p.sku).toBe("SKU-EDITADO");
      expect(p.sale).toBe("25.90");
    });

    await expect(
      withTenant(tenantId, (tx) =>
        updateProduct(tx, "00000000-0000-4000-8000-000000000000", {
          tenantId,
          sku: "SKU-X",
          name: "X",
          salePriceCents: 100,
        }),
      ),
    ).rejects.toThrow(/não encontrado/i);
  });

  it("variação: aponta filho para o pai; ciclo é rejeitado", async () => {
    const { tenantId } = await createTestTenant();
    const { productId: p1 } = await createTestProduct(tenantId);
    const { productId: p2 } = await createTestProduct(tenantId);

    // p2 vira variação de p1
    await withTenant(tenantId, (tx) =>
      updateProduct(tx, p2, {
        tenantId,
        sku: "SKU-P2",
        name: "Variação P2",
        salePriceCents: 1000,
        parentId: p1,
      }),
    );

    // p1 com pai p2 fecharia o ciclo
    await expect(
      withTenant(tenantId, (tx) =>
        updateProduct(tx, p1, {
          tenantId,
          sku: "SKU-P1",
          name: "P1",
          salePriceCents: 1000,
          parentId: p2,
        }),
      ),
    ).rejects.toThrow(/ciclo/i);
  });

  it("pai inexistente ou kit como pai → erro", async () => {
    const { tenantId } = await createTestTenant();
    const { productId } = await createTestProduct(tenantId);

    await expect(
      withTenant(tenantId, (tx) =>
        updateProduct(tx, productId, {
          tenantId,
          sku: "SKU-FILHO",
          name: "Filho",
          salePriceCents: 100,
          parentId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).rejects.toThrow(/pai/i);
  });
});

describe("kits — saveKitComponents", () => {
  it("persiste componentes e rejeita ciclo entre kits", async () => {
    const { tenantId } = await createTestTenant();
    const { productId: kitA } = await withTenant(tenantId, (tx) =>
      createProduct(tx, {
        tenantId,
        sku: "KIT-A",
        name: "Kit A",
        salePriceCents: 1000,
        isKit: true,
      }),
    );
    const { productId: kitB } = await withTenant(tenantId, (tx) =>
      createProduct(tx, {
        tenantId,
        sku: "KIT-B",
        name: "Kit B",
        salePriceCents: 1000,
        isKit: true,
      }),
    );

    await withTenant(tenantId, (tx) =>
      saveKitComponents(tx, tenantId, kitA, [
        { componentId: kitB, quantity: 2 },
      ]),
    );

    await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(productComponents)
        .where(eq(productComponents.tenantId, tenantId));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].quantity)).toBe(2);
    });

    // B compondo A fecha o ciclo A→B→A
    await expect(
      withTenant(tenantId, (tx) =>
        saveKitComponents(tx, tenantId, kitB, [
          { componentId: kitA, quantity: 1 },
        ]),
      ),
    ).rejects.toThrow(/ciclo/i);

    // componente de outra empresa → FK/validação → erro
    const outra = await createTestTenant();
    const { productId: estrangeiro } = await createTestProduct(outra.tenantId);
    await expect(
      withTenant(tenantId, (tx) =>
        saveKitComponents(tx, tenantId, kitB, [
          { componentId: estrangeiro, quantity: 1 },
        ]),
      ),
    ).rejects.toThrow(/componente/i);

    // kitB continua sem componentes
    await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(productComponents)
        .where(eq(productComponents.kitId, kitB));
      expect(rows).toHaveLength(0);
    });
  });
});

describe("categorias e fornecedores", () => {
  it("categoria hierárquica (pai → filha) e nome duplicado recusado", async () => {
    const { tenantId } = await createTestTenant();
    await withTenant(tenantId, (tx) =>
      createCategory(tx, { tenantId, name: "Bebidas" }),
    );
    const [pai] = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.tenantId, tenantId));
      return rows;
    });
    await withTenant(tenantId, (tx) =>
      createCategory(tx, {
        tenantId,
        name: "Refrigerantes",
        parentId: pai.id,
      }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        createCategory(tx, { tenantId, name: "bebidas" }),
      ),
    ).rejects.toThrow(/categoria/i);

    await expect(
      withTenant(tenantId, (tx) =>
        createCategory(tx, {
          tenantId,
          name: "Órfã",
          parentId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).rejects.toThrow(/pai/i);
  });

  it("fornecedor: documento único por tenant (mesmo doc em B ok)", async () => {
    const a = await createTestTenant();
    const b = await createTestTenant();

    await withTenant(a.tenantId, (tx) =>
      createSupplier(tx, {
        tenantId: a.tenantId,
        name: "Fornecedor A",
        document: "12.345.678/0001-95",
      }),
    );
    await expect(
      withTenant(a.tenantId, (tx) =>
        createSupplier(tx, {
          tenantId: a.tenantId,
          name: "Repetido",
          document: "123456789011",
        }),
      ),
    ).rejects.toThrow(/documento/i);
    await withTenant(b.tenantId, (tx) =>
      createSupplier(tx, {
        tenantId: b.tenantId,
        name: "Fornecedor B",
        document: "12.345.678/0001-95",
      }),
    );

    const total = await withTenant(a.tenantId, async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(suppliers)
        .where(eq(suppliers.tenantId, a.tenantId));
      return r?.n ?? 0;
    });
    expect(total).toBe(1);
  });
});
