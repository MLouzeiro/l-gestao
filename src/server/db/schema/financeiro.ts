import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  financialDirectionEnum,
  financialSourceEnum,
  financialStatusEnum,
} from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";

// Financeiro — baixas imutáveis (financial_payments sem UPDATE/DELETE policy)

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    direction: financialDirectionEnum("direction").notNull(),
    source: financialSourceEnum("source").notNull(),
    sourceId: uuid("source_id"),
    description: text("description").notNull(),
    dueDate: date("due_date", { mode: "date" }).notNull(),
    installmentNumber: integer("installment_number"),
    installmentCount: integer("installment_count"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paidAmount: numeric("paid_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: financialStatusEnum("status").notNull().default("OPEN"),
    notes: text("notes"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    unique("financial_accounts_tenant_id_uq").on(t.tenantId, t.id),
    check("financial_accounts_amount_positive", sql`amount > 0`),
    check(
      "financial_accounts_paid_range",
      sql`paid_amount >= 0 AND paid_amount <= amount`,
    ),
    index("financial_accounts_tenant_status_due_idx").on(
      t.tenantId,
      t.status,
      t.dueDate,
    ),
    index("financial_accounts_tenant_source_idx").on(
      t.tenantId,
      t.source,
      t.sourceId,
    ),
    index("financial_accounts_tenant_direction_idx").on(
      t.tenantId,
      t.direction,
      t.dueDate,
    ),
  ],
);

export const financialPayments = pgTable(
  "financial_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    financialAccountId: uuid("financial_account_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    interest: numeric("interest", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    discount: numeric("discount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    paymentMethod: text("payment_method").notNull(),
    paidAt: date("paid_at", { mode: "date" }).notNull().default(sql`current_date`),
    receivedBy: uuid("received_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.financialAccountId],
      foreignColumns: [financialAccounts.tenantId, financialAccounts.id],
      name: "financial_payments_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.receivedBy],
      foreignColumns: [users.id],
      name: "financial_payments_received_by_fk",
    }).onDelete("set null"),
    check("financial_payments_amount_positive", sql`amount > 0`),
    check("financial_payments_interest_non_negative", sql`interest >= 0`),
    check("financial_payments_discount_non_negative", sql`discount >= 0`),
    index("financial_payments_tenant_account_idx").on(
      t.tenantId,
      t.financialAccountId,
    ),
    index("financial_payments_tenant_paid_at_idx").on(t.tenantId, t.paidAt),
  ],
);

// Numeração sequencial por tenant com row lock (SELECT ... FOR UPDATE)
export const counters = pgTable(
  "counters",
  {
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    nextValue: bigint("next_value", { mode: "number" })
      .notNull()
      .default(1),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "counters_tenant_fk",
    }).onDelete("cascade"),
  ],
);
