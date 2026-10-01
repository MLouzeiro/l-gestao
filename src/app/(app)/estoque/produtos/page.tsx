import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  brands,
  categories,
  productComponents,
  products,
  suppliers,
  units,
} from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { resolvePermissions } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { toCents } from "@/lib/money";
import { calcMarginPercent } from "@/server/modules/cadastros/product-rules";
import { ProdutosClient } from "@/components/estoque/produtos-client";

export default async function ProdutosPage() {
  const { tenantId, role } = await requirePermission("stock.view");
  const canManage = resolvePermissions(role).includes("stock.manage");

  const data = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        description: products.description,
        barcode: products.barcode,
        salePrice: products.salePrice,
        costPrice: products.costPrice,
        minStock: products.minStock,
        maxStock: products.maxStock,
        status: products.status,
        isKit: products.isKit,
        trackBatch: products.trackBatch,
        requiresPrescription: products.requiresPrescription,
        parentId: products.parentId,
        categoryId: products.categoryId,
        categoryName: categories.name,
        brandId: products.brandId,
        brandName: brands.name,
        unitId: products.unitId,
        unitKey: units.key,
      })
      .from(products)
      .leftJoin(
        categories,
        and(
          eq(categories.id, products.categoryId),
          eq(categories.tenantId, products.tenantId),
        ),
      )
      .leftJoin(
        brands,
        and(
          eq(brands.id, products.brandId),
          eq(brands.tenantId, products.tenantId),
        ),
      )
      .leftJoin(units, eq(units.id, products.unitId))
      .where(
        and(eq(products.tenantId, tenantId), isNull(products.deletedAt)),
      )
      .orderBy(products.name)
      .limit(1000);

    const categorias = await tx
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(
        and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)),
      )
      .orderBy(categories.name);

    const marcas = await tx
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(and(eq(brands.tenantId, tenantId), isNull(brands.deletedAt)))
      .orderBy(brands.name);

    const unidades = await tx
      .select({ key: units.key, name: units.name, decimals: units.decimals })
      .from(units)
      .orderBy(units.name);

    const fornecedores = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        document: suppliers.document,
        phone: suppliers.phone,
      })
      .from(suppliers)
      .where(
        and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)),
      )
      .orderBy(suppliers.name)
      .limit(200);

    const compRows = await tx
      .select({
        kitId: productComponents.kitId,
        componentId: productComponents.componentId,
        quantity: productComponents.quantity,
        componentName: products.name,
        componentSku: products.sku,
      })
      .from(productComponents)
      .innerJoin(
        products,
        and(
          eq(products.id, productComponents.componentId),
          eq(products.tenantId, productComponents.tenantId),
        ),
      )
      .where(eq(productComponents.tenantId, tenantId));

    return { rows, categorias, marcas, unidades, fornecedores, compRows };
  });

  const kits: Record<
    string,
    { componentId: string; name: string; sku: string; quantity: number }[]
  > = {};
  for (const c of data.compRows) {
    (kits[c.kitId] ??= []).push({
      componentId: c.componentId,
      name: c.componentName,
      sku: c.componentSku,
      quantity: Number(c.quantity),
    });
  }

  const produtos = data.rows.map((p) => ({
    ...p,
    margin: calcMarginPercent(toCents(p.costPrice), toCents(p.salePrice)),
    kitComponents: kits[p.id] ?? [],
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Produtos
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Catálogo com categorias, marcas, kits, variações e status.
          </p>
        </div>
        <a
          href="/estoque"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Voltar ao estoque
        </a>
      </div>

      <ProdutosClient
        produtos={produtos}
        categorias={data.categorias}
        marcas={data.marcas}
        unidades={data.unidades}
        fornecedores={data.fornecedores}
        canManage={canManage}
      />
    </div>
  );
}
