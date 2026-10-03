import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { users } from "./auth";

// RBAC — members/invitations sem RLS (membership validado na aplicação,
// conforme docs/ARQUITETURA.md §4). roles/role_permissions com RLS.

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roles_tenant_key_uq").on(t.tenantId, t.key)],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_org_user_uq").on(t.organizationId, t.userId),
    index("members_user_idx").on(t.userId),
    index("members_org_idx").on(t.organizationId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    // token: gerado pelo nosso fluxo de e-mail (Fase 5); o plugin Better Auth
    // não o escreve — nullable para o INSERT do plugin funcionar
    token: text("token").unique(),
    status: text("status").notNull().default("pending"),
    // exigido pelo plugin de organizações (quem convidou)
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_org_email_uq").on(t.organizationId, t.email),
    index("invitations_org_idx").on(t.organizationId),
    index("invitations_token_idx").on(t.token),
  ],
);

export const systemRoles = ["ADMIN", "GERENTE", "FINANCEIRO", "ESTOQUISTA", "VENDEDOR", "VISUALIZADOR"] as const;

export const permissionCatalog = [
  { key: "products.view", module: "products" },
  { key: "products.manage", module: "products" },
  { key: "stock.view", module: "stock" },
  { key: "stock.manage", module: "stock" },
  { key: "stock.transfer", module: "stock" },
  { key: "stock.inventory", module: "stock" },
  { key: "purchases.view", module: "purchases" },
  { key: "purchases.manage", module: "purchases" },
  { key: "sales.view", module: "sales" },
  { key: "sales.manage", module: "sales" },
  { key: "sales.discount", module: "sales" },
  { key: "sales.billing", module: "sales" },
  { key: "finance.view", module: "finance" },
  { key: "finance.manage", module: "finance" },
  { key: "finance.payments", module: "finance" },
  { key: "users.view", module: "users" },
  { key: "users.manage", module: "users" },
  { key: "reports.view", module: "reports" },
  { key: "audit.view", module: "audit" },
  { key: "settings.manage", module: "settings" },
  { key: "units.view", module: "units" },
  { key: "units.manage", module: "units" },
] as const;
