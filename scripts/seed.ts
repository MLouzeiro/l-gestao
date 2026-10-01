import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import {
  brands,
  categories,
  members,
  products,
  tenants,
  tenantSettings,
  units,
  users,
  warehouses,
} from "@/server/db/schema";
import { provisionTenant } from "@/server/modules/tenancy/provision";
import { applyMovement } from "@/server/modules/estoque/movement.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { toCents } from "@/lib/money";

// Seed: usuário demo + empresas + unidades globais + catálogo
// (categorias/marcas) + produtos com saldo inicial (Fases 4, 6 e 7).
// Idempotente: pode rodar quantas vezes quiser.

type DemoTenant = {
  name: string;
  slug: string;
  segment: "COMERCIO_GERAL" | "FARMACIA";
  role: "ADMIN" | "GERENTE";
};

const DEMO_TENANTS: DemoTenant[] = [
  {
    name: "Empresa Demo",
    slug: "empresa-demo",
    segment: "COMERCIO_GERAL",
    role: "ADMIN",
  },
  {
    name: "Farmácia Demo",
    slug: "farmacia-demo",
    segment: "FARMACIA",
    role: "GERENTE",
  },
];

const DEMO_EMAIL = "teste@empresa.com.br";
const DEMO_PASSWORD = "senha12345";

const UNIDADES: { key: string; name: string; decimals: number }[] = [
  { key: "UN", name: "Unidade", decimals: 0 },
  { key: "CX", name: "Caixa", decimals: 0 },
  { key: "PC", name: "Peça", decimals: 0 },
  { key: "KG", name: "Quilograma", decimals: 3 },
  { key: "G", name: "Grama", decimals: 3 },
  { key: "L", name: "Litro", decimals: 3 },
  { key: "ML", name: "Mililitro", decimals: 3 },
  { key: "MT", name: "Metro", decimals: 3 },
];

type DemoProduct = {
  sku: string;
  name: string;
  unitKey: string;
  salePrice: string;
  costPrice: string;
  qty: number;
  minStock?: number;
  trackBatch?: boolean;
  batchNumber?: string;
  batchExpiresAt?: string;
  category?: string;
  brand?: string;
};

const DEMO_PRODUCTS: Record<string, DemoProduct[]> = {
  "empresa-demo": [
    { sku: "SKU-CAF-500", name: "Café Torrado 500g", unitKey: "UN", salePrice: "18.90", costPrice: "10.00", qty: 48, minStock: 10, category: "Bebidas", brand: "Norte" },
    { sku: "SKU-PAP-A4", name: "Papel A4 500 folhas", unitKey: "CX", salePrice: "27.90", costPrice: "16.50", qty: 30, minStock: 5, category: "Papelaria", brand: "Norte" },
    { sku: "SKU-REF-2L", name: "Refrigerante Cola 2L", unitKey: "UN", salePrice: "9.90", costPrice: "5.40", qty: 72, minStock: 12, category: "Bebidas", brand: "Norte" },
    { sku: "SKU-DES-500", name: "Detergente 500ml", unitKey: "UN", salePrice: "3.50", costPrice: "1.80", qty: 60, minStock: 12, category: "Limpeza", brand: "Norte" },
  ],
  "farmacia-demo": [
    { sku: "SKU-DIP-10", name: "Dipirona 500mg 10 comp.", unitKey: "CX", salePrice: "12.90", costPrice: "6.50", qty: 40, minStock: 10, trackBatch: true, batchNumber: "DIP-2026-01", batchExpiresAt: "2027-06-30", category: "Medicamentos", brand: "Vitalis" },
    { sku: "SKU-VIT-C", name: "Vitamina C 1g 10 cp", unitKey: "CX", salePrice: "15.90", costPrice: "8.20", qty: 30, minStock: 8, trackBatch: true, batchNumber: "VITC-2026-02", batchExpiresAt: "2027-09-30", category: "Medicamentos", brand: "Vitalis" },
    { sku: "SKU-ALG-1L", name: "Álcool 70% 1L", unitKey: "L", salePrice: "8.90", costPrice: "4.60", qty: 25, minStock: 5, category: "Higiene", brand: "Vitalis" },
  ],
};

const DEMO_CATALOG: Record<string, { categories: string[]; brand: string }> = {
  "empresa-demo": { categories: ["Bebidas", "Limpeza", "Papelaria"], brand: "Norte" },
  "farmacia-demo": { categories: ["Medicamentos", "Higiene"], brand: "Vitalis" },
};

async function ensureUnits(): Promise<void> {
  let criadas = 0;
  for (const u of UNIDADES) {
    const [existing] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.key, u.key))
      .limit(1);
    if (existing) continue;
    await db.insert(units).values({ ...u, isSystem: true });
    criadas += 1;
  }
  console.log(
    `• Unidades: ${UNIDADES.length} no catálogo (${criadas} criadas agora)`,
  );
}

async function ensureDemoUser(): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);
  if (existing) {
    console.log(`• Usuário já existe: ${DEMO_EMAIL}`);
    return existing.id;
  }

  try {
    const created = await auth.api.signUpEmail({
      headers: new Headers(),
      body: {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: "Teste Usuario",
      },
    });
    console.log(`• Usuário criado: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    return created.user.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Não foi possível criar o usuário demo (${DEMO_EMAIL}): ${msg}`,
    );
  }
}

async function ensureTenant(data: DemoTenant, userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, data.slug))
    .limit(1);

  let tenantId: string;
  if (existing) {
    tenantId = existing.id;
    console.log(`• Empresa já existe: ${data.name} (${data.slug})`);
  } else {
    const [created] = await db
      .insert(tenants)
      .values({
        name: data.name,
        slug: data.slug,
        segment: data.segment,
      })
      .returning({ id: tenants.id });
    tenantId = created.id;
    console.log(`• Empresa criada: ${data.name} (${data.slug})`);
  }

  // settings padrão + papéis-sistema + permissões + depósito PRINCIPAL
  await provisionTenant(tenantId);
  console.log(`  └─ provision: settings + papéis + depósito ok`);

  // Demo da Fase 8: farmácia com FEFO automático e bloqueio de venda
  // de lote vencido (configuração por empresa).
  if (data.slug === "farmacia-demo") {
    await db
      .update(tenantSettings)
      .set({
        controleFefo: true,
        bloqueioVendaVencido: true,
        updatedAt: new Date(),
      })
      .where(eq(tenantSettings.tenantId, tenantId));
    console.log("  └─ flags: controle_fefo + bloqueio_venda_vencido ativos");
  }

  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(eq(members.userId, userId), eq(members.organizationId, tenantId)),
    )
    .limit(1);
  if (member) {
    console.log(`  └─ membership já existia (${data.role})`);
    return tenantId;
  }

  await db.insert(members).values({
    organizationId: tenantId,
    userId,
    role: data.role,
  });
  console.log(`  └─ membership criado: usuário é ${data.role}`);
  return tenantId;
}

async function ensureProducts(tenantId: string, slug: string): Promise<void> {
  const lista = DEMO_PRODUCTS[slug];
  if (!lista?.length) return;

  await withTenant(tenantId, async (tx) => {
    const [deposito] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, tenantId),
          eq(warehouses.isDefault, true),
          isNull(warehouses.deletedAt),
        ),
      )
      .limit(1);
    if (!deposito) throw new Error(`Sem depósito padrão para ${slug}`);

    const todasUnidades = await tx
      .select({ id: units.id, key: units.key })
      .from(units);
    const unidadeId = new Map<string, string>(
      todasUnidades.map((u) => [u.key, u.id]),
    );

    // Catálogo: categorias + marca (cria se não existir; idempotente)
    const catalogo = DEMO_CATALOG[slug] ?? { categories: [], brand: "" };
    const categoriaId = new Map<string, string>();
    for (const nome of catalogo.categories) {
      const [existe] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.name, nome)),
        )
        .limit(1);
      if (existe) {
        categoriaId.set(nome, existe.id);
        continue;
      }
      const [criada] = await tx
        .insert(categories)
        .values({ tenantId, name: nome })
        .returning({ id: categories.id });
      categoriaId.set(nome, criada.id);
      console.log(`  └─ categoria criada: ${nome}`);
    }
    let marcaId: string | null = null;
    if (catalogo.brand) {
      const [marca] = await tx
        .select({ id: brands.id })
        .from(brands)
        .where(
          and(eq(brands.tenantId, tenantId), eq(brands.name, catalogo.brand)),
        )
        .limit(1);
      if (marca) marcaId = marca.id;
      else {
        const [criada] = await tx
          .insert(brands)
          .values({ tenantId, name: catalogo.brand })
          .returning({ id: brands.id });
        marcaId = criada.id;
        console.log(`  └─ marca criada: ${catalogo.brand}`);
      }
    }

    for (const p of lista) {
      const catId = (p.category && categoriaId.get(p.category)) || null;
      const [existe] = await tx
        .select({
          id: products.id,
          categoryId: products.categoryId,
          brandId: products.brandId,
        })
        .from(products)
        .where(
          and(eq(products.tenantId, tenantId), eq(products.sku, p.sku)),
        )
        .limit(1);
      if (existe) {
        // Backfill: produtos criados antes do catálogo ganham categoria/marca
        if ((!existe.categoryId && catId) || (!existe.brandId && marcaId)) {
          await tx
            .update(products)
            .set({
              categoryId: existe.categoryId ?? catId,
              brandId: existe.brandId ?? marcaId,
              updatedAt: new Date(),
            })
            .where(eq(products.id, existe.id));
        }
        continue;
      }

      const [criado] = await tx
        .insert(products)
        .values({
          tenantId,
          sku: p.sku,
          name: p.name,
          unitId: unidadeId.get(p.unitKey) ?? null,
          categoryId: catId,
          brandId: marcaId,
          salePrice: p.salePrice,
          costPrice: p.costPrice,
          minStock: p.minStock ? String(p.minStock) : "0",
          trackBatch: p.trackBatch ?? false,
        })
        .returning({ id: products.id });

      await applyMovement(tx, {
        tenantId,
        type: "ENTRADA_COMPRA",
        productId: criado.id,
        warehouseId: deposito.id,
        quantity: p.qty,
        unitCostCents: toCents(p.costPrice),
        batchNumber: p.batchNumber,
        batchExpiresAt: p.batchExpiresAt,
        reason: "Carga inicial (seed)",
      });
      console.log(`  └─ produto ${p.sku}: +${p.qty} (saldo inicial)`);
    }
  });
}

async function main() {
  console.log("Seed — Estoque + Vendas + Financeiro");
  console.log("────────────────────────────────────");

  await ensureUnits();
  const userId = await ensureDemoUser();
  for (const tenant of DEMO_TENANTS) {
    const tenantId = await ensureTenant(tenant, userId);
    await ensureProducts(tenantId, tenant.slug);
  }

  console.log("────────────────────────────────────");
  console.log("Seed concluído com sucesso.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed falhou:", err);
    process.exit(1);
  });
