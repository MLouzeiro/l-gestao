import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatSaleNumber } from "@/server/modules/vendas/sales-rules";
import { getSaleDetail } from "@/server/modules/vendas/sales.service";
import { loadSaleFormData } from "@/server/modules/vendas/form-data";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { VendaForm } from "@/components/vendas/venda-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarVendaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { session, tenantId, role } = await requirePermission("sales.manage");
  const canDiscount = resolvePermissions(role).includes("sales.discount");

  const dados = await withTenant(tenantId, async (tx) => {
    const venda = await getSaleDetail(tx, tenantId, id);
    if (!venda) return null;
    const allowedWarehouseIds = await accessibleWarehouseIds(
      tx,
      tenantId,
      session.user.id,
      role,
    );
    const form = await loadSaleFormData(tx, tenantId, { allowedWarehouseIds });
    return { venda, form };
  });

  if (!dados) notFound();
  const { venda, form } = dados;

  // Só rascunho edita — o serviço bloqueia, aqui só evita tela inútil.
  if (venda.status !== "DRAFT") redirect(`/vendas/${venda.id}`);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Editar {formatSaleNumber(venda.number)}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Vendas confirmadas ou faturadas não podem ser editadas.
          </p>
        </div>
        <Link
          href={`/vendas/${venda.id}`}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Voltar
        </Link>
      </div>

      <VendaForm
        depositos={form.depositos}
        produtos={form.produtos}
        clientes={form.clientes}
        vendedores={form.vendedores}
        canDiscount={canDiscount}
        initial={{
          saleId: venda.id,
          warehouseId: venda.warehouseId,
          customerId: venda.customerId,
          sellerId: venda.sellerId,
          notes: venda.notes,
          installments: venda.installments,
          orderDiscountCents: venda.orderDiscountCents,
          items: venda.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            discountCents: i.discountCents,
          })),
        }}
      />
    </div>
  );
}
