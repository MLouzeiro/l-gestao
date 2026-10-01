import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createAccessControl, organization, twoFactor } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  invitations,
  members,
  sessions,
  tenants,
  twoFactors,
  users,
  verifications,
} from "@/server/db/schema";
import { provisionTenant } from "@/server/modules/tenancy/provision";
import { systemRoles } from "@/server/db/schema";
import { canChangeRole, canRemoveMember } from "@/server/rbac/admin-rules";

// Statements do plugin de organizações (gestão de empresa/membros/convites
// DENTRO do Better Auth). O RBAC por feature continua no nosso catálogo
// (rbac/permissions.ts + role_permissions).
const ac = createAccessControl({
  organization: ["update", "delete"] as const,
  member: ["create", "update", "delete"] as const,
  invitation: ["create", "cancel"] as const,
  team: ["create", "update", "delete"] as const,
  ac: ["create", "read", "update", "delete"] as const,
});

const orgPluginRoles = {
  ADMIN: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  GERENTE: ac.newRole({ ac: ["read"] }),
  FINANCEIRO: ac.newRole({ ac: ["read"] }),
  ESTOQUISTA: ac.newRole({ ac: ["read"] }),
  VENDEDOR: ac.newRole({ ac: ["read"] }),
  VISUALIZADOR: ac.newRole({ ac: ["read"] }),
} satisfies Record<(typeof systemRoles)[number], ReturnType<typeof ac.newRole>>;

// Membros da empresa (tabela members sem RLS — membership validado na
// aplicação) para as regras do último ADMIN nos hooks do plugin.
async function loadMembers(organizationId: string) {
  return db
    .select({ userId: members.userId, role: members.role })
    .from(members)
    .where(eq(members.organizationId, organizationId));
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
      // Plugin de organizações: tenants/members/invitations
      organization: tenants,
      member: members,
      invitation: invitations,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // Nossos PKs são uuid com default (gen_random_uuid) — o Better Auth
  // não deve gerar id próprio (geraria string, não uuid).
  advanced: {
    database: {
      generateId: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 dias
    updateAge: 60 * 60 * 24, // renova a cada 24h
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // cache de sessão por 5 min (menos idas ao banco)
    },
  },
  plugins: [
    nextCookies(),
    twoFactor({
      issuer: "Estoque+",
    }),
    organization({
      // Quem cria a empresa vira ADMIN (papel-sistema nosso, não "owner")
      creatorRole: "ADMIN",
      roles: orgPluginRoles,
      // v1 sem SMTP: o aceite de convite não exige e-mail verificado.
      // Ligar quando houver envio real de e-mails (fase de deploy).
      requireEmailVerificationOnInvitation: false,
      organizationHooks: {
        // Toda empresa nova recebe: tenant_settings padrão,
        // papéis-sistema e suas permissões (seed M1)
        afterCreateOrganization: async ({ organization }) => {
          console.log(
            `[hook] afterCreateOrganization disparado: ${organization.id}`,
          );
          await provisionTenant(organization.id);
          console.log(`[hook] provisionTenant ok: ${organization.id}`);
        },
        // Regra M1: protege TODOS os caminhos (UI e API direta)
        beforeRemoveMember: async ({ member, organization }) => {
          const list = await loadMembers(organization.id);
          const check = canRemoveMember(list, member.userId);
          if (!check.ok) {
            throw new APIError("FORBIDDEN", { message: check.reason });
          }
        },
        beforeUpdateMemberRole: async ({ member, newRole, organization }) => {
          const list = await loadMembers(organization.id);
          const check = canChangeRole(list, member.userId, newRole);
          if (!check.ok) {
            throw new APIError("FORBIDDEN", { message: check.reason });
          }
        },
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
