"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/server/auth";
import { systemRoles } from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { audit } from "@/server/audit/log";

// Equipe + convites (M1 / Fase 5).
// Toda ação sensível passa por requirePermission; a regra do último ADMIN é
// aplicada nos hooks beforeRemoveMember/beforeUpdateMemberRole do plugin.

export type EquipeFormState =
  | { error?: string; link?: string; ok?: boolean }
  | null;

async function getSessionOrLogin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

// APIError do Better Auth carrega a mensagem em body.message
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof APIError) {
    const body = err.body as { message?: string } | undefined;
    if (body?.message) return String(body.message);
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const papelSchema = z.enum(systemRoles);

const conviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  role: papelSchema,
});

export async function _trocarPapel(
  _prev: EquipeFormState,
  formData: FormData,
): Promise<EquipeFormState> {
  const { tenantId, session } = await requirePermission("users.manage");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!memberId) return { error: "Membro não encontrado." };
  const parsed = papelSchema.safeParse(role);
  if (!parsed.success) return { error: "Papel inválido." };

  try {
    await auth.api.updateMemberRole({
      headers: await headers(),
      body: { memberId, role: parsed.data, organizationId: tenantId },
    });
  } catch (err) {
    return {
      error: apiErrorMessage(err, "Não foi possível alterar o papel."),
    };
  }
  await withTenant(tenantId, session.user.id, async (tx) => {
    await audit(tx, {
      action: "ALTERACAO_PERMISSAO",
      module: "equipe",
      entityType: "member",
      entityId: memberId,
      after: { role: parsed.data },
    });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function _removerMembro(
  _prev: EquipeFormState,
  formData: FormData,
): Promise<EquipeFormState> {
  const { tenantId, session } = await requirePermission("users.manage");
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return { error: "Membro não encontrado." };

  try {
    await auth.api.removeMember({
      headers: await headers(),
      body: { memberIdOrEmail: memberId, organizationId: tenantId },
    });
  } catch (err) {
    return { error: apiErrorMessage(err, "Não foi possível remover.") };
  }
  await withTenant(tenantId, session.user.id, async (tx) => {
    await audit(tx, {
      action: "REMOCAO_USUARIO",
      module: "equipe",
      entityType: "member",
      entityId: memberId,
    });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function _criarConvite(
  _prev: EquipeFormState,
  formData: FormData,
): Promise<EquipeFormState> {
  const { tenantId, session } = await requirePermission("users.manage");
  const parsed = conviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    const invitation = await auth.api.createInvitation({
      headers: await headers(),
      body: {
        email: parsed.data.email,
        role: parsed.data.role,
        organizationId: tenantId,
      },
    });
    const origin =
      (await headers()).get("origin") ?? "http://localhost:3000";
    const link = `${origin}/convite?id=${invitation.id}`;
    // v1: sem SMTP — o link é exibido na tela (doc M1). O console.log só
    // existe em dev: em produção o link no log vazaría o token do convite.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[convite] ${parsed.data.email} → ${link}`);
    }
    await withTenant(tenantId, session.user.id, async (tx) => {
      await audit(tx, {
        action: "CONVITE_USUARIO",
        module: "equipe",
        entityType: "invitation",
        entityId: invitation.id,
        after: { email: parsed.data.email, role: parsed.data.role },
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, link };
  } catch (err) {
    return {
      error: apiErrorMessage(err, "Não foi possível criar o convite."),
    };
  }
}

export async function _cancelarConvite(formData: FormData): Promise<void> {
  const { tenantId, session } = await requirePermission("users.manage");
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return;
  try {
    await auth.api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });
    await withTenant(tenantId, session.user.id, async (tx) => {
      await audit(tx, {
        action: "CANCELAMENTO_CONVITE",
        module: "equipe",
        entityType: "invitation",
        entityId: invitationId,
      });
    });
  } catch (err) {
    console.error("[convite] cancelar falhou:", apiErrorMessage(err, "?"));
  }
  revalidatePath("/", "layout");
}

const aceitarSchema = z.object({ invitationId: z.string().min(1) });

export async function _aceitarConvite(
  _prev: EquipeFormState,
  formData: FormData,
): Promise<EquipeFormState> {
  // Convite: aceitante pode ainda não ter membership — só exige sessão
  const session = await getSessionOrLogin();
  const parsed = aceitarSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) return { error: "Convite inválido." };

  let organizationIdAceite = "";
  try {
    const aceite = await auth.api.acceptInvitation({
      headers: await headers(),
      body: { invitationId: parsed.data.invitationId },
    });
    organizationIdAceite = aceite.invitation.organizationId;
  } catch (err) {
    return {
      error: apiErrorMessage(err, "Não foi possível aceitar o convite."),
    };
  }
  if (!organizationIdAceite) {
    return { error: "Não foi possível aceitar o convite." };
  }
  await withTenant(organizationIdAceite, session.user.id, async (tx) => {
    await audit(tx, {
      action: "ACEITE_CONVITE",
      module: "equipe",
      entityType: "invitation",
      entityId: parsed.data.invitationId,
    });
  });
  revalidatePath("/", "layout");
  redirect("/empresas");
}
