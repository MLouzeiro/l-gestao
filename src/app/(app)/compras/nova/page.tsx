import Link from "next/link";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { loadPurchaseFormData } from "@/server/modules/compras/form-data";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { CompraForm } from "@/components/compras/compra-form";

export default async function NovaCompraPage() {
  const { session, tenantId, role } = await requirePermission(
    "purchases.manage",
  );
  const form = await withTenant(tenantId, async (tx) => {
    const allowedWarehouseIds = await accessibleWarehouseIds(
      tx,
      tenantId,
      session.user.id,
      role,
    );
    return loadPurchaseFormData(tx, tenantId, { allowedWarehouseIds });
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Nova compra</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rascunho sem efeito — estoque e contas a pagar só na confirmação.
          </p>
        </div>
        <Link
          href="/compras"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Voltar
        </Link>
      </div>

      <CompraForm
        fornecedores={form.fornecedores}
        depositos={form.depositos}
        produtos={form.produtos}
        initial={null}
      />
    </div>
  );
}
