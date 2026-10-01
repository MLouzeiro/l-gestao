"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { units } from "@/server/db/schema";
import { toCents } from "@/lib/money";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  ProductError,
  createBrand,
  createCategory,
  createProduct,
  createSupplier,
  saveKitComponents,
  softDeleteProduct,
  updateProduct,
  type ProductFields,
} from "@/server/modules/cadastros/product.service";

// Ações de cadastro de produtos (Fase 7): requirePermission + withTenant
// (RLS) + validação pura no serviço. Nunca confiar no cliente.

export type ProdutoFormState =
  | { ok?: boolean; error?: string; message?: string }
  | null;

const produtoSchema = z.object({
  sku: z.string().trim().min(1, "Informe o SKU."),
  name: z.string().trim().min(1, "Informe o nome."),
  salePrice: z.string().trim().regex(/^\d+([.,]\d{1,2})?$/, "Preço de venda inválido (ex.: 19,90)."),
  costPrice: z.string().trim().regex(/^\d+([.,]\d{1,2})?$/, "Custo inválido (ex.: 10,50).").or(z.literal("")),
  minStock: z.string().trim().regex(/^\d+([.,]\d{1,3})?$/, "Estoque mínimo inválido.").or(z.literal("")),
  maxStock: z.string().trim().regex(/^\d+([.,]\d{1,3})?$/, "Estoque máximo inválido.").or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]),
});

function parseQtyOpt(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseFloat(value.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("Quantidade inválida.");
  return n;
}

export async function _salvarProduto(
  _prev: ProdutoFormState,
  formData: FormData,
): Promise<ProdutoFormState> {
  const { tenantId } = await requirePermission("stock.manage");

  const id = String(formData.get("id") ?? "").trim();
  const raw = {
    sku: String(formData.get("sku") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "").trim(),
    barcode: String(formData.get("barcode") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? "").trim(),
    brandId: String(formData.get("brandId") ?? "").trim(),
    unitKey: String(formData.get("unitKey") ?? "").trim(),
    parentId: String(formData.get("parentId") ?? "").trim(),
    salePrice: String(formData.get("salePrice") ?? ""),
    costPrice: String(formData.get("costPrice") ?? ""),
    minStock: String(formData.get("minStock") ?? ""),
    maxStock: String(formData.get("maxStock") ?? ""),
    status: String(formData.get("status") ?? "ACTIVE"),
    trackBatch: formData.get("trackBatch") === "on",
    requiresPrescription: formData.get("requiresPrescription") === "on",
    isKit: formData.get("isKit") === "on",
  };

  const parsed = produtoSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  let salePriceCents: number;
  let costPriceCents: number | undefined;
  let minStock: number;
  let maxStock: number | null;
  try {
    salePriceCents = toCents(parsed.data.salePrice);
    costPriceCents = parsed.data.costPrice
      ? toCents(parsed.data.costPrice)
      : undefined;
    minStock = parseQtyOpt(parsed.data.minStock) ?? 0;
    maxStock = parseQtyOpt(parsed.data.maxStock);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Valor inválido." };
  }

  let unitId: string | null = null;
  if (raw.unitKey) {
    const [u] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.key, raw.unitKey))
      .limit(1);
    unitId = u?.id ?? null;
  }

  const fields: ProductFields = {
    tenantId,
    sku: raw.sku,
    name: raw.name,
    description: raw.description || null,
    barcode: raw.barcode || null,
    categoryId: raw.categoryId || null,
    brandId: raw.brandId || null,
    unitId,
    salePriceCents,
    costPriceCents,
    minStock,
    maxStock,
    trackBatch: raw.trackBatch,
    requiresPrescription: raw.requiresPrescription,
    isKit: raw.isKit,
    parentId: raw.parentId || null,
    status: parsed.data.status,
  };

  // componentes do kit (linhas repetidas componentId[] + componentQty[])
  const compIds = formData.getAll("componentId").map((v) => String(v).trim()).filter(Boolean);
  const compQtys = formData.getAll("componentQty").map((v) => String(v).trim());
  const components = compIds.map((componentId, i) => ({
    componentId,
    quantity: parseFloat((compQtys[i] ?? "").replace(",", ".")),
  }));

  try {
    await withTenant(tenantId, async (tx) => {
      const { productId } = id
        ? await updateProduct(tx, id, fields)
        : await createProduct(tx, fields);
      if (fields.isKit) {
        await saveKitComponents(tx, tenantId, productId, components);
      }
    });
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao salvar." };
  }

  revalidatePath("/estoque/produtos");
  revalidatePath("/estoque");
  return {
    ok: true,
    message: id ? "Produto atualizado." : "Produto cadastrado.",
  };
}

export async function _excluirProduto(
  _prev: ProdutoFormState,
  formData: FormData,
): Promise<ProdutoFormState> {
  const { tenantId } = await requirePermission("stock.manage");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Produto não encontrado." };

  try {
    await withTenant(tenantId, (tx) => softDeleteProduct(tx, tenantId, id));
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao excluir." };
  }

  revalidatePath("/estoque/produtos");
  revalidatePath("/estoque");
  return { ok: true, message: "Produto excluído." };
}

const nomeSchema = z.string().trim().min(2, "Nome muito curto.").max(100, "Nome muito longo.");

export async function _criarCategoria(
  _prev: ProdutoFormState,
  formData: FormData,
): Promise<ProdutoFormState> {
  const { tenantId } = await requirePermission("stock.manage");
  const name = String(formData.get("name") ?? "");
  const parentId = String(formData.get("parentId") ?? "").trim();
  const check = nomeSchema.safeParse(name);
  if (!check.success) return { error: check.error.issues[0]?.message };

  try {
    await withTenant(tenantId, (tx) =>
      createCategory(tx, { tenantId, name: check.data, parentId: parentId || null }),
    );
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao criar categoria." };
  }
  revalidatePath("/estoque/produtos");
  return { ok: true, message: "Categoria criada." };
}

export async function _criarMarca(
  _prev: ProdutoFormState,
  formData: FormData,
): Promise<ProdutoFormState> {
  const { tenantId } = await requirePermission("stock.manage");
  const name = String(formData.get("name") ?? "");
  const check = nomeSchema.safeParse(name);
  if (!check.success) return { error: check.error.issues[0]?.message };

  try {
    await withTenant(tenantId, (tx) => createBrand(tx, { tenantId, name: check.data }));
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao criar marca." };
  }
  revalidatePath("/estoque/produtos");
  return { ok: true, message: "Marca criada." };
}

const fornecedorSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(150, "Nome muito longo."),
  document: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")),
});

export async function _criarFornecedor(
  _prev: ProdutoFormState,
  formData: FormData,
): Promise<ProdutoFormState> {
  const { tenantId } = await requirePermission("stock.manage");
  const parsed = fornecedorSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    document: String(formData.get("document") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await withTenant(tenantId, (tx) =>
      createSupplier(tx, {
        tenantId,
        name: parsed.data.name,
        document: parsed.data.document || null,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
      }),
    );
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao criar fornecedor." };
  }
  revalidatePath("/estoque/produtos");
  return { ok: true, message: "Fornecedor cadastrado." };
}
