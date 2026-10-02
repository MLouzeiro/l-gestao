import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { getCashSummary } from "@/server/modules/pdv/cash.service";
import {
  getPdvSettings,
  listPdvCustomers,
  listPdvProducts,
} from "@/server/modules/pdv/pdv.service";
import { PdvClient } from "@/components/pdv/pdv-client";

export default async function PdvPage() {
  const { tenantId, role } = await requirePermission("sales.view");

  const data = await withTenant(tenantId, async (tx) => {
    const settings = await getPdvSettings(tx, tenantId);
    if (!settings) return null;
    const [products, customers, cash] = await Promise.all([
      listPdvProducts(tx, tenantId, settings.warehouseId),
      listPdvCustomers(tx, tenantId),
      getCashSummary(tx, tenantId),
    ]);
    return { settings, products, customers, cash };
  });

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Empresa sem depósito cadastrado — cadastre um depósito em Estoque antes
        de usar o PDV.
      </div>
    );
  }

  return (
    <PdvClient
      products={data.products}
      customers={data.customers}
      settings={data.settings}
      cash={data.cash}
      canFinance={resolvePermissions(role).includes("finance.manage")}
    />
  );
}
