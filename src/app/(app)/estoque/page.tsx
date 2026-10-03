import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  products,
  stockBalances,
  stockMovements,
  tenantSettings,
  units,
  users,
  warehouses,
} from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { resolvePermissions } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { formatBRL, toCents } from "@/lib/money";
import { MovimentacaoForm } from "@/components/estoque/movimentacao-form";
import { ProdutoForm } from "@/components/estoque/produto-form";

export default async function EstoquePage() {
  const { session, tenantId, role } = await requirePermission("stock.view");
  const canManage = resolvePermissions(role).includes("stock.manage");

  const data = await withTenant(tenantId, async (tx) => {
    const allowed = await accessibleWarehouseIds(
      tx,
      tenantId,
      session.user.id,
      role,
    );
    const allowedCond = allowed
      ? inArray(stockBalances.warehouseId, allowed)
      : undefined;
    const allowedMovCond = allowed
      ? inArray(stockMovements.warehouseId, allowed)
      : undefined;
    const saldos = await tx
      .select({
        productId: stockBalances.productId,
        quantity: stockBalances.quantity,
        reserved: stockBalances.reserved,
        warehouseName: warehouses.name,
        sku: products.sku,
        name: products.name,
        trackBatch: products.trackBatch,
        costPrice: products.costPrice,
        unitKey: units.key,
      })
      .from(stockBalances)
      .innerJoin(
        products,
        and(
          eq(products.id, stockBalances.productId),
          eq(products.tenantId, stockBalances.tenantId),
        ),
      )
      .innerJoin(
        warehouses,
        and(
          eq(warehouses.id, stockBalances.warehouseId),
          eq(warehouses.tenantId, stockBalances.tenantId),
        ),
      )
      .leftJoin(units, eq(units.id, products.unitId))
      .where(
        allowed
          ? and(eq(stockBalances.tenantId, tenantId), allowedCond)
          : eq(stockBalances.tenantId, tenantId),
      )
      .orderBy(products.name)
      .limit(500);

    const produtos = await tx
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        trackBatch: products.trackBatch,
      })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.status, "ACTIVE"),
          isNull(products.deletedAt),
        ),
      )
      .orderBy(products.name)
      .limit(300);

    const depositos = await tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, tenantId),
          isNull(warehouses.deletedAt),
          allowed ? inArray(warehouses.id, allowed) : undefined,
        ),
      )
      .orderBy(warehouses.name);

    const historico = await tx
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        unitCost: stockMovements.unitCost,
        totalCost: stockMovements.totalCost,
        occurredAt: stockMovements.occurredAt,
        reason: stockMovements.reason,
        productName: products.name,
        productSku: products.sku,
        warehouseName: warehouses.name,
        userName: users.name,
      })
      .from(stockMovements)
      .innerJoin(
        products,
        and(
          eq(products.id, stockMovements.productId),
          eq(products.tenantId, stockMovements.tenantId),
        ),
      )
      .innerJoin(
        warehouses,
        and(
          eq(warehouses.id, stockMovements.warehouseId),
          eq(warehouses.tenantId, stockMovements.tenantId),
        ),
      )
      .leftJoin(users, eq(users.id, stockMovements.userId))
      .where(
        allowed
          ? and(eq(stockMovements.tenantId, tenantId), allowedMovCond)
          : eq(stockMovements.tenantId, tenantId),
      )
      .orderBy(desc(stockMovements.occurredAt))
      .limit(20);

    const [cont] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(
        allowed
          ? and(eq(stockMovements.tenantId, tenantId), allowedMovCond)
          : eq(stockMovements.tenantId, tenantId),
      );

    const unidades = await tx
      .select({ key: units.key, name: units.name, decimals: units.decimals })
      .from(units)
      .orderBy(units.name);

    const [st] = await tx
      .select({
        fefo: tenantSettings.controleFefo,
        bloqueio: tenantSettings.bloqueioVendaVencido,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    return {
      saldos,
      produtos,
      depositos,
      historico,
      totalMovimentos: cont?.total ?? 0,
      unidades,
      fefo: st?.fefo ?? false,
      bloqueioVencido: st?.bloqueio ?? false,
    };
  });

  const comSaldo = data.saldos.filter((s) => Number(s.quantity) > 0);
  const valorEstoque = comSaldo.reduce(
    (acc, s) => acc + Number(s.quantity) * Number(s.costPrice),
    0,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Estoque</h1>
          <p className="mt-1 text-sm text-slate-500">
            Saldos por produto/depósito, movimentações e histórico.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/estoque/inventario"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Inventário →
          </a>
          <a
            href="/estoque/produtos"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Gerenciar produtos →
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card
          titulo="Produtos com saldo"
          valor={`${comSaldo.length} de ${data.produtos.length}`}
        />
        <Card titulo="Valor em estoque (custo)" valor={formatBRL(valorEstoque)} />
        <Card
          titulo="Movimentos registrados"
          valor={String(data.totalMovimentos)}
        />
      </div>

      {canManage ? (
        <MovimentacaoForm
          produtos={data.produtos}
          depositos={data.depositos}
          fefo={data.fefo}
          bloqueioVencido={data.bloqueioVencido}
        />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Seu papel permite consultar os saldos (leitura apenas).
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Saldo por produto
          </h2>
        </div>
        {data.saldos.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            {data.produtos.length === 0
              ? "Nenhum produto cadastrado ainda."
              : "Nenhum saldo registrado — faça a primeira entrada."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 font-medium">Depósito</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 text-right font-medium">Reservado</th>
                  <th className="px-4 py-2 text-right font-medium">Disponível</th>
                  <th className="px-4 py-2 text-right font-medium">Custo médio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.saldos.map((s) => {
                  const q = Number(s.quantity);
                  const r = Number(s.reserved);
                  return (
                    <tr key={`${s.productId}-${s.warehouseName}`}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-slate-800">
                          {s.name}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">
                          {s.sku}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {s.warehouseName}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-slate-800">
                        {q.toFixed(3).replace(/\.?0+$/, "")}{" "}
                        <span className="text-xs text-slate-400">
                          {s.unitKey ?? "un"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-amber-600">
                        {r > 0 ? r.toFixed(3).replace(/\.?0+$/, "") : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {(q - r).toFixed(3).replace(/\.?0+$/, "")}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">
                        {formatBRL(Number(s.costPrice))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Últimas movimentações
          </h2>
        </div>
        {data.historico.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nenhuma movimentação ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 text-right font-medium">Qtd</th>
                  <th className="px-4 py-2 text-right font-medium">Unitário</th>
                  <th className="px-4 py-2 font-medium">Depósito</th>
                  <th className="px-4 py-2 font-medium">Usuário</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.historico.map((m) => {
                  const entrada = m.type.startsWith("ENTRADA");
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-2 text-slate-600">
                        {m.occurredAt.toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            entrada
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {tipoLabel(m.type)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {m.productName}
                        <span className="ml-2 text-xs text-slate-400">
                          {m.productSku}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-slate-800">
                        {entrada ? "+" : "−"}
                        {Number(m.quantity).toFixed(3).replace(/\.?0+$/, "")}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">
                        {formatBRL(toCents(m.unitCost))}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {m.warehouseName}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {m.userName ?? "—"}
                        {m.reason && (
                          <span className="ml-1 text-xs text-slate-400">
                            · {m.reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && <ProdutoForm unidades={data.unidades} />}
    </div>
  );
}

function Card({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-slate-400">{titulo}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{valor}</p>
    </div>
  );
}

const TIPO_LABELS: Record<string, string> = {
  ENTRADA_COMPRA: "Compra",
  ENTRADA_DEVOLUCAO: "Devolução cliente",
  ENTRADA_AJUSTE: "Ajuste (+)",
  SAIDA_VENDA: "Venda",
  SAIDA_DEVOLUCAO_FORNECEDOR: "Dev. fornecedor",
  SAIDA_PERDA: "Perda",
  SAIDA_QUEBRA: "Quebra",
  SAIDA_VENCIMENTO: "Vencimento",
  SAIDA_AJUSTE: "Ajuste (−)",
  TRANSFERENCIA_ENTRADA: "Transf. entrada",
  TRANSFERENCIA_SAIDA: "Transf. saída",
};

function tipoLabel(type: string): string {
  return TIPO_LABELS[type] ?? type;
}
