import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  brands,
  categories,
  productComponents,
  products,
  suppliers,
} from "@/server/db/schema";
import { fromCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  hasKitCycle,
  hasParentCycle,
  normalizeDocument,
  normalizeSku,
  validateDocument,
  validateKitComponents,
  validateProductInput,
  validateVariation,
  type KitComponent,
} from "./product-rules";

// Serviço de cadastros de produtos (Fase 7). Tudo roda dentro de
// withTenant() (RLS); validações puras em product-rules.ts (TDD).

export class ProductError extends Error {}

export type ProductFields = {
  tenantId: string;
  sku: string;
  name: string;
  description?: string | null;
  barcode?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  unitId?: string | null;
  /** centavos */
  salePriceCents: number;
  /** centavos */
  costPriceCents?: number;
  minStock?: number;
  maxStock?: number | null;
  trackBatch?: boolean;
  requiresPrescription?: boolean;
  isKit?: boolean;
  parentId?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
};

function assertProductInput(input: ProductFields, sku: string): void {
  const check = validateProductInput({
    sku,
    name: input.name,
    salePriceCents: input.salePriceCents,
    costPriceCents: input.costPriceCents,
    minStock: input.minStock,
    maxStock: input.maxStock,
    barcode: input.barcode,
  });
  if (!check.ok) throw new ProductError(check.reason);
}

async function assertSkuFree(
  tx: TenantTx,
  tenantId: string,
  sku: string,
  excludeId?: string,
): Promise<void> {
  const [dup] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.sku, sku),
        isNull(products.deletedAt),
        excludeId ? ne(products.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  if (dup) throw new ProductError(`Já existe um produto com o SKU ${sku}.`);
}

async function assertParent(
  tx: TenantTx,
  tenantId: string,
  parentId: string | null,
  productId: string,
  isKit: boolean,
): Promise<void> {
  const check = validateVariation(productId, parentId, isKit);
  if (!check.ok) throw new ProductError(check.reason);
  if (!parentId) return;
  const [parent] = await tx
    .select({ isKit: products.isKit })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.id, parentId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!parent) throw new ProductError("Produto pai não encontrado.");
  if (parent.isKit) throw new ProductError("Kit não pode ser produto pai.");
}

async function assertCatalogRefs(
  tx: TenantTx,
  tenantId: string,
  categoryId?: string | null,
  brandId?: string | null,
): Promise<void> {
  if (categoryId) {
    const [c] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.tenantId, tenantId),
          eq(categories.id, categoryId),
          isNull(categories.deletedAt),
        ),
      )
      .limit(1);
    if (!c) throw new ProductError("Categoria não encontrada.");
  }
  if (brandId) {
    const [b] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          eq(brands.tenantId, tenantId),
          eq(brands.id, brandId),
          isNull(brands.deletedAt),
        ),
      )
      .limit(1);
    if (!b) throw new ProductError("Marca não encontrada.");
  }
}

function productValues(input: ProductFields, sku: string) {
  return {
    tenantId: input.tenantId,
    sku,
    name: input.name.trim(),
    description: input.description ?? null,
    barcode: input.barcode?.trim() || null,
    categoryId: input.categoryId ?? null,
    brandId: input.brandId ?? null,
    unitId: input.unitId ?? null,
    salePrice: fromCents(input.salePriceCents),
    costPrice: fromCents(input.costPriceCents ?? 0),
    minStock: String(input.minStock ?? 0),
    maxStock: input.maxStock != null ? String(input.maxStock) : null,
    trackBatch: input.trackBatch ?? false,
    requiresPrescription: input.requiresPrescription ?? false,
    isKit: input.isKit ?? false,
    parentId: input.parentId ?? null,
    status: input.status ?? "ACTIVE",
    updatedAt: new Date(),
  };
}

export async function createProduct(
  tx: TenantTx,
  input: ProductFields,
): Promise<{ productId: string }> {
  const sku = normalizeSku(input.sku);
  assertProductInput(input, sku);
  await assertSkuFree(tx, input.tenantId, sku);
  await assertParent(tx, input.tenantId, input.parentId ?? null, "", input.isKit ?? false);
  await assertCatalogRefs(tx, input.tenantId, input.categoryId, input.brandId);

  const [row] = await tx
    .insert(products)
    .values({ ...productValues(input, sku), createdAt: new Date() })
    .returning({ id: products.id });
  return { productId: row.id };
}

export async function updateProduct(
  tx: TenantTx,
  productId: string,
  input: ProductFields,
): Promise<{ productId: string }> {
  // referência primeiro: "não encontrado" ganha do erro de formato
  const [existing] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        eq(products.id, productId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new ProductError("Produto não encontrado.");

  const sku = normalizeSku(input.sku);
  assertProductInput(input, sku);

  await assertSkuFree(tx, input.tenantId, sku, productId);

  const parentId = input.parentId ?? null;
  const isKit = input.isKit ?? false;
  await assertParent(tx, input.tenantId, parentId, productId, isKit);

  if (parentId) {
    const all = await tx
      .select({ id: products.id, parentId: products.parentId })
      .from(products)
      .where(
        and(eq(products.tenantId, input.tenantId), isNull(products.deletedAt)),
      );
    const map = new Map(all.map((r) => [r.id, r.parentId]));
    if (hasParentCycle(map, productId, parentId)) {
      throw new ProductError(
        "Variação não pode criar ciclo na cadeia de produtos pai.",
      );
    }
  }

  await assertCatalogRefs(tx, input.tenantId, input.categoryId, input.brandId);

  await tx
    .update(products)
    .set(productValues(input, sku))
    .where(
      and(eq(products.tenantId, input.tenantId), eq(products.id, productId)),
    );

  // deixou de ser kit → remove componentes órfãos (FK em cascata só no hard delete)
  if (!isKit) {
    await tx
      .delete(productComponents)
      .where(
        and(
          eq(productComponents.tenantId, input.tenantId),
          eq(productComponents.kitId, productId),
        ),
      );
  }

  return { productId };
}

export async function softDeleteProduct(
  tx: TenantTx,
  tenantId: string,
  productId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.id, productId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) throw new ProductError("Produto não encontrado.");

  await tx
    .update(products)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.id, productId),
        isNull(products.deletedAt),
      ),
    );
}

export async function saveKitComponents(
  tx: TenantTx,
  tenantId: string,
  kitId: string,
  components: KitComponent[],
): Promise<void> {
  const [kit] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.id, kitId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!kit) throw new ProductError("Produto não encontrado.");

  const check = validateKitComponents(kitId, components);
  if (!check.ok) throw new ProductError(check.reason);

  for (const c of components) {
    const [comp] = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, c.componentId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    if (!comp) {
      throw new ProductError(
        "Componente inválido: produto não encontrado nesta empresa.",
      );
    }
  }

  // ciclo no grafo COMPLETO de kits da empresa com as arestas propostas
  const existentes = await tx
    .select()
    .from(productComponents)
    .where(eq(productComponents.tenantId, tenantId));
  const edges = existentes
    .filter((e) => e.kitId !== kitId)
    .map((e) => ({ kitId: e.kitId, componentId: e.componentId }));
  for (const c of components) {
    edges.push({ kitId, componentId: c.componentId });
  }
  if (hasKitCycle(edges)) {
    throw new ProductError(
      "Ciclo de kits detectado (A compõe B e B compõe A).",
    );
  }

  await tx
    .delete(productComponents)
    .where(
      and(
        eq(productComponents.tenantId, tenantId),
        eq(productComponents.kitId, kitId),
      ),
    );

  if (components.length > 0) {
    await tx.insert(productComponents).values(
      components.map((c) => ({
        tenantId,
        kitId,
        componentId: c.componentId,
        quantity: c.quantity.toFixed(3),
      })),
    );
  }
}

// ---------- categorias / marcas / fornecedores ----------

export type CategoryInput = {
  tenantId: string;
  name: string;
  parentId?: string | null;
};

export async function createCategory(
  tx: TenantTx,
  input: CategoryInput,
): Promise<{ categoryId: string }> {
  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new ProductError("Nome da categoria deve ter de 2 a 100 caracteres.");
  }
  const parentId = input.parentId || null;
  if (parentId) {
    const [parent] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.tenantId, input.tenantId),
          eq(categories.id, parentId),
          isNull(categories.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) throw new ProductError("Categoria pai não encontrada.");
  }

  const [dup] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.tenantId, input.tenantId),
        isNull(categories.deletedAt),
        sql`lower(${categories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (dup) throw new ProductError("Já existe uma categoria com esse nome.");

  const [row] = await tx
    .insert(categories)
    .values({ tenantId: input.tenantId, name, parentId })
    .returning({ id: categories.id });
  return { categoryId: row.id };
}

export type BrandInput = { tenantId: string; name: string };

export async function createBrand(
  tx: TenantTx,
  input: BrandInput,
): Promise<{ brandId: string }> {
  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new ProductError("Nome da marca deve ter de 2 a 100 caracteres.");
  }
  const [dup] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.tenantId, input.tenantId),
        isNull(brands.deletedAt),
        sql`lower(${brands.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (dup) throw new ProductError("Já existe uma marca com esse nome.");

  const [row] = await tx
    .insert(brands)
    .values({ tenantId: input.tenantId, name })
    .returning({ id: brands.id });
  return { brandId: row.id };
}

export type SupplierInput = {
  tenantId: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
};

export async function createSupplier(
  tx: TenantTx,
  input: SupplierInput,
): Promise<{ supplierId: string }> {
  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 150) {
    throw new ProductError("Nome do fornecedor deve ter de 2 a 150 caracteres.");
  }
  const docCheck = validateDocument(input.document);
  if (!docCheck.ok) throw new ProductError(docCheck.reason);

  const document = input.document ? normalizeDocument(input.document) : null;
  if (document) {
    const [dup] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, input.tenantId),
          eq(suppliers.document, document),
          isNull(suppliers.deletedAt),
        ),
      )
      .limit(1);
    if (dup) {
      throw new ProductError("Já existe um fornecedor com esse documento.");
    }
  }

  const [row] = await tx
    .insert(suppliers)
    .values({
      tenantId: input.tenantId,
      name,
      document,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
    })
    .returning({ id: suppliers.id });
  return { supplierId: row.id };
}
