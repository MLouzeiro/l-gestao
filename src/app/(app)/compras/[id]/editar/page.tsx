import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { dateOnlyInput } from "@/lib/dates";
import { formatPurchaseNumber } from "@/server/modules/compras/purchase-rules";
import { getPurchaseDetail } from "@/server/modules/compras/purchase.service";
import { loadPurchaseFormData } from "@/server/modules/compras/form-data";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { CompraForm } from "@/components/compras/compra-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarCompraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { session, tenantId, role } = await requirePermission(
    "purchases.manage",
  );

  const dados = await withTenant(tenantId, async (tx) => {
    const compra = await getPurchaseDetail(tx, tenantId, id);
    if (!compra) return null;
    const allowedWarehouseIds = await accessibleWarehouseIds(
      tx,
      tenantId,
      session.user.id,
      role,
    );
    const form = await loadPurchaseFormData(tx, tenantId, {
      allowedWarehouseIds,
    });
    return { compra, form };
  });

  if (!dados) notFound();
  const { compra, form } = dados;

  // Só OPEN edita — o serviço bloqueia, aqui só evita tela inútil.
  if (compra.status !== "OPEN") redirect(`/compras/${compra.id}`);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Editar {formatPurchaseNumber(compra.number)}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Notas confirmadas ou canceladas não podem ser editadas.
          </p>
        </div>
        <Link
          href={`/compras/${compra.id}`}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Voltar
        </Link>
      </div>

      <CompraForm
        fornecedores={form.fornecedores}
        depositos={form.depositos}
        produtos={form.produtos}
        initial={{
          purchaseId: compra.id,
          supplierId: compra.supplierId,
          warehouseId: compra.warehouseId,
          entryDate: dateOnlyInput(compra.entryDate),
          documentNumber: compra.documentNumber,
          notes: compra.notes,
          installments: compra.installments,
          items: compra.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCostCents: i.unitCostCents,
            batchNumber: i.batchNumber,
            expiresAt: i.expiresAt ? dateOnlyInput(i.expiresAt) : null,
          })),
        }}
      />
    </div>
  );
}
