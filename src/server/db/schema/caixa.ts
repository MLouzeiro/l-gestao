import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cashMovementTypeEnum, cashStatusEnum, salePaymentMethodEnum } from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";
import { salesOrders } from "./vendas";

// Caixa do PDV — abertura/fechamento com contagem e livro de movimentos
// imutável (append-only, no espírito de stock_movements/financial_payments).

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: cashStatusEnum("status").notNull().default("OPEN"),
    openingAmount: numeric("opening_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    closingAmount: numeric("closing_amount", { precision: 14, scale: 2 }),
    countedCash: numeric("counted_cash", { precision: 14, scale: 2 }),
    countedCard: numeric("counted_card", { precision: 14, scale: 2 }),
    countedPix: numeric("counted_pix", { precision: 14, scale: 2 }),
    countedOther: numeric("counted_other", { precision: 14, scale: 2 }),
    expectedCash: numeric("expected_cash", { precision: 14, scale: 2 }),
    expectedCard: numeric("expected_card", { precision: 14, scale: 2 }),
    expectedPix: numeric("expected_pix", { precision: 14, scale: 2 }),
    expectedOther: numeric("expected_other", { precision: 14, scale: 2 }),
    difference: numeric("difference", { precision: 14, scale: 2 }),
    openedBy: uuid("opened_by").references(() => users.id, {
      onDelete: "set null",
    }),
    closedBy: uuid("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    notes: text("notes"),
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
    unique("cash_registers_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("cash_registers_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("cash_registers_tenant_open_uq")
      .on(t.tenantId)
      .where(sql`status = 'OPEN'`),
    check("cash_registers_opening_non_negative", sql`opening_amount >= 0`),
    index("cash_registers_tenant_status_idx").on(t.tenantId, t.status),
    index("cash_registers_tenant_opened_idx").on(t.tenantId, t.openedAt),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    cashRegisterId: uuid("cash_register_id").notNull(),
    type: cashMovementTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paymentMethod: salePaymentMethodEnum("payment_method"),
    saleId: uuid("sale_id"),
    description: text("description"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("cash_movements_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.cashRegisterId],
      foreignColumns: [cashRegisters.tenantId, cashRegisters.id],
      name: "cash_movements_cash_register_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
      name: "cash_movements_sale_fk",
    }).onDelete("set null"),
    check("cash_movements_amount_non_negative", sql`amount >= 0`),
    index("cash_movements_tenant_register_idx").on(
      t.tenantId,
      t.cashRegisterId,
    ),
    index("cash_movements_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("cash_movements_tenant_sale_idx").on(t.tenantId, t.saleId),
  ],
);
