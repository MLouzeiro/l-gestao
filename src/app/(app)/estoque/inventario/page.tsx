import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  batches,
  inventories,
  inventoryItems,
  products,
  units,
  users,
  warehouses,
} from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { resolvePermissions } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { AbrirInventarioForm } from "@/components/estoque/inventario-abrir";
import {
  InventarioContagem,
  type InventarioItem,
} from "@/components/estoque/inventario-contagem";

// Fase 9 — Inventário: abrir (snapshot do sistema) → contar → aplicar ajustes.

export default async function InventarioPage() {
  const { tenantId, role } = await requirePermission("stock.view");
  const podeContar = resolvePermissions(role).includes("stock.inventory");

  const data = await withTenant(tenantId, async (tx) => {
    const depositos = await tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .orderBy(warehouses.name);

    const abertos = await tx
      .select({
        inventoryId: inventories.id,
        warehouseId: inventories.warehouseId,
        warehouseName: warehouses.name,
        notes: inventories.notes,
        createdAt: inventories.createdAt,
        userName: users.name,
      })
      .from(inventories)
      .innerJoin(
        warehouses,
        and(
          eq(warehouses.id, inventories.warehouseId),
          eq(warehouses.tenantId, inventories.tenantId),
        ),
      )
      .leftJoin(users, eq(users.id, inventories.userId))
      .where(
        and(eq(inventories.tenantId, tenantId), isNull(inventories.appliedAt)),
      )
      .orderBy(desc(inventories.createdAt));

    const abertosIds = abertos.map((a) => a.inventoryId);
    const itensBrutos = abertosIds.length
      ? await tx
          .select({
            itemId: inventoryItems.id,
            inventoryId: inventoryItems.inventoryId,
            sku: products.sku,
            name: products.name,
            unitKey: units.key,
            batchNumber: batches.batchNumber,
            expiresAt: batches.expiresAt,
            systemQty: inventoryItems.systemQty,
            countedQty: inventoryItems.countedQty,
          })
          .from(inventoryItems)
          .innerJoin(
            products,
            and(
              eq(products.id, inventoryItems.productId),
              eq(products.tenantId, inventoryItems.tenantId),
            ),
          )
          .leftJoin(units, eq(units.id, products.unitId))
          .leftJoin(
            batches,
            and(
              eq(batches.id, inventoryItems.batchId),
              eq(batches.tenantId, inventoryItems.tenantId),
            ),
          )
          .where(
            and(
              eq(inventoryItems.tenantId, tenantId),
              inArray(inventoryItems.inventoryId, abertosIds),
            ),
          )
          .orderBy(products.name)
      : [];

    const aplicados = await tx
      .select({
        inventoryId: inventories.id,
        warehouseName: warehouses.name,
        notes: inventories.notes,
        appliedAt: inventories.appliedAt,
        userName: users.name,
      })
      .from(inventories)
      .innerJoin(
        warehouses,
        and(
          eq(warehouses.id, inventories.warehouseId),
          eq(warehouses.tenantId, inventories.tenantId),
        ),
      )
      .leftJoin(users, eq(users.id, inventories.userId))
      .where(
        and(eq(inventories.tenantId, tenantId), isNotNull(inventories.appliedAt)),
      )
      .orderBy(desc(inventories.appliedAt))
      .limit(10);

    const aplicadosIds = aplicados.map((a) => a.inventoryId);
    const stats = aplicadosIds.length
      ? await tx
          .select({
            inventoryId: inventoryItems.inventoryId,
            total: sql<number>`count(*)::int`,
            contados: sql<number>`count(${inventoryItems.countedQty})::int`,
            ajustes: sql<number>`count(*) filter (where ${inventoryItems.difference} <> 0)::int`,
          })
          .from(inventoryItems)
          .where(inArray(inventoryItems.inventoryId, aplicadosIds))
          .groupBy(inventoryItems.inventoryId)
      : [];

    return { depositos, abertos, itensBrutos, aplicados, stats };
  });

  const itensPorInventario = new Map<string, InventarioItem[]>();
  for (const i of data.itensBrutos) {
    const list = itensPorInventario.get(i.inventoryId) ?? [];
    list.push({
      itemId: i.itemId,
      sku: i.sku,
      name: i.name,
      batchNumber: i.batchNumber,
      expiresAt: i.expiresAt
        ? new Date(i.expiresAt).toISOString().slice(0, 10)
        : null,
      systemQty: Number(i.systemQty),
      countedQty: i.countedQty === null ? null : Number(i.countedQty),
      unitKey: i.unitKey,
    });
    itensPorInventario.set(i.inventoryId, list);
  }

  const statsPorInventario = new Map(data.stats.map((s) => [s.inventoryId, s]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Inventário</h1>
          <p className="mt-1 text-sm text-slate-500">
            Contagem por depósito: diferença entre sistema e físico vira
            movimento de ajuste.
          </p>
        </div>
        <a
          href="/estoque"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Voltar ao estoque
        </a>
      </div>

      {data.abertos.map((a) => (
        <InventarioContagem
          key={a.inventoryId}
          inventoryId={a.inventoryId}
          warehouseName={a.warehouseName}
          notes={a.notes}
          itens={itensPorInventario.get(a.inventoryId) ?? []}
          podeContar={podeContar}
        />
      ))}

      {podeContar ? (
        <AbrirInventarioForm depositos={data.depositos} />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Seu papel permite consultar os inventários (leitura apenas).
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Inventários aplicados
          </h2>
        </div>
        {data.aplicados.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhum inventário aplicado ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Aplicado em</th>
                  <th className="px-4 py-2 font-medium">Depósito</th>
                  <th className="px-4 py-2 text-right font-medium">Itens</th>
                  <th className="px-4 py-2 text-right font-medium">Ajustes</th>
                  <th className="px-4 py-2 font-medium">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.aplicados.map((a) => {
                  const st = statsPorInventario.get(a.inventoryId);
                  return (
                    <tr key={a.inventoryId}>
                      <td className="px-4 py-2 text-slate-600">
                        {a.appliedAt
                          ? a.appliedAt.toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {a.warehouseName}
                        {a.notes && (
                          <span className="ml-2 text-xs text-slate-400">
                            · {a.notes}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">
                        {st?.total ?? 0}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-slate-800">
                        {st?.ajustes ?? 0}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {a.userName ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
