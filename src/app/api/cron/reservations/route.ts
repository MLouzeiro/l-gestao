import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { listTenantIdsForCron } from "@/server/modules/financeiro/financial.service";
import { expireReservations } from "@/server/modules/vendas/sales.service";
import { withTenant } from "@/server/tenant/with-tenant";

// Cron (Vercel Cron): reservas ATIVAS com expires_at vencido viram EXPIRED
// e liberam `stock_balances.reserved`. Mesma autenticação do cron/overdue.

function checkSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET não configurado." },
        { status: 500 },
      );
    }
    return null;
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const negado = checkSecret(request);
  if (negado) return negado;

  try {
    const tenantIds = await db.transaction((tx) => listTenantIdsForCron(tx));

    let expired = 0;
    const porTenant: Record<string, number> = {};
    for (const tenantId of tenantIds) {
      const n = await withTenant(tenantId, (tx) =>
        expireReservations(tx, tenantId),
      );
      if (n > 0) porTenant[tenantId] = n;
      expired += n;
    }

    return NextResponse.json({
      ok: true,
      tenants: tenantIds.length,
      expired,
      porTenant,
    });
  } catch (err) {
    console.error(
      "cron/reservations falhou:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Falha ao expirar reservas." },
      { status: 500 },
    );
  }
}
