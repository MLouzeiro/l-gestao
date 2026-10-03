import Link from "next/link";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { loadSaleFormData } from "@/server/modules/vendas/form-data";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { VendaForm } from "@/components/vendas/venda-form";

export default async function NovaVendaPage() {
  const { session, tenantId, role } = await requirePermission("sales.manage");
  const canDiscount = resolvePermissions(role).includes("sales.discount");

  const form = await withTenant(tenantId, async (tx) => {
    const allowedWarehouseIds = await accessibleWarehouseIds(
      tx,
      tenantId,
      session.user.id,
      role,
    );
    return loadSaleFormData(tx, tenantId, { allowedWarehouseIds });
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Nova venda</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rascunho sem efeito no estoque — a reserva só acontece na
            confirmação.
          </p>
        </div>
        <Link
          href="/vendas"
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
        initial={null}
      />
    </div>
  );
}
