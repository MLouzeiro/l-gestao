import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import {
  listTenantIdsForCron,
  markAccountsOverdue,
} from "@/server/modules/financeiro/financial.service";
import { withTenant } from "@/server/tenant/with-tenant";

// Cron diário (Vercel Cron): parcelas vencidas (OPEN/PARTIAL) → OVERDUE.
// Auth: header `authorization: Bearer <CRON_SECRET>` — a Vercel envia sozinha
// quando CRON_SECRET está definido nas variáveis de ambiente do projeto.

function checkSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Sem segredo: só aceitamos fora de produção (dev/teste local).
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
    // `tenants` não tem RLS — a listagem cross-tenant do cron é intencional;
    // cada atualização roda dentro de withTenant (RLS por tenant).
    const tenantIds = await db.transaction((tx) => listTenantIdsForCron(tx));

    let updated = 0;
    const porTenant: Record<string, number> = {};
    for (const tenantId of tenantIds) {
      const n = await withTenant(tenantId, (tx) =>
        markAccountsOverdue(tx, tenantId),
      );
      if (n > 0) porTenant[tenantId] = n;
      updated += n;
    }

    return NextResponse.json({
      ok: true,
      tenants: tenantIds.length,
      updated,
      porTenant,
    });
  } catch (err) {
    console.error("cron/overdue falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Falha ao atualizar contas vencidas." },
      { status: 500 },
    );
  }
}
