"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members } from "@/server/db/schema";
import { withTenant } from "@/server/tenant/with-tenant";
import { audit } from "@/server/audit/log";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "empresa";
}

const criarSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(80, "Nome muito longo"),
});

export type FormState = { error?: string } | null;

export async function _criarEmpresa(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const parsed = criarSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nome inválido." };
  }

  // slug único (o plugin rejeita slug duplicado)
  const base = slugify(parsed.data.name);
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  let novoTenantId = "";
  try {
    // Cria a empresa (plugin) → hook provisiona settings/papéis.
    // O create grava a empresa ativa no banco mas NÃO atualiza o cookie de
    // sessão (cookieCache) — o setActive explícito força o refresh.
    const created = await auth.api.createOrganization({
      headers: await headers(),
      body: { name: parsed.data.name, slug },
    });
    novoTenantId = created.id;
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: created.id },
    });
  } catch {
    return { error: "Não foi possível criar a empresa. Tente outro nome." };
  }

  await withTenant(novoTenantId, session.user.id, async (tx) => {
    await audit(tx, {
      action: "CRIACAO_EMPRESA",
      module: "empresas",
      entityType: "tenant",
      entityId: novoTenantId,
    });
  });

  revalidatePath("/", "layout");
  redirect("/painel");
}

export async function selecionarEmpresa(formData: FormData): Promise<void> {
  const session = await requireSession();
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId) redirect("/empresas");

  // Só troca para empresa onde o usuário é membro
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(members.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) redirect("/empresas");

  await auth.api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId },
  });

  revalidatePath("/", "layout");
  redirect("/painel");
}

export async function sair(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
