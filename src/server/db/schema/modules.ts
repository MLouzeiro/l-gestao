import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { subscriptionStatusEnum } from "./enums";
import { plans, tenants } from "./tenancy";
import { users } from "./auth";

// Núcleo SaaS (PROMPT MESTRE §4/§35): catálogo global de módulos, módulos por
// plano, contratação por empresa (RLS), assinatura e contrato aceito.

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
});

export const planModules = pgTable(
  "plan_modules",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.moduleId] })],
);

export const tenantModules = pgTable(
  "tenant_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    contractedAt: timestamp("contracted_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    contractedBy: uuid("contracted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("tenant_modules_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("tenant_modules_tenant_module_uq").on(
      t.tenantId,
      t.moduleId,
    ),
    index("tenant_modules_tenant_active_idx").on(t.tenantId, t.active),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    status: subscriptionStatusEnum("status").notNull().default("TRIAL"),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }),
    canceledAt: timestamp("canceled_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("subscriptions_tenant_id_uq").on(t.tenantId, t.id),
    unique("subscriptions_tenant_uq").on(t.tenantId),
    index("subscriptions_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const tenantContractVersions = pgTable(
  "tenant_contract_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    contentHash: text("content_hash").notNull(),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    acceptedBy: uuid("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    unique("tenant_contract_versions_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("tenant_contract_versions_uq").on(t.tenantId, t.version),
    index("tenant_contract_versions_tenant_idx").on(t.tenantId, t.acceptedAt),
  ],
);

export type SubscriptionStatusValue =
  (typeof subscriptionStatusEnum.enumValues)[number];
