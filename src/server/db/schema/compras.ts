import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { purchaseStatusEnum } from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";
import { products, suppliers, warehouses } from "./cadastros";

// Compras — nota de entrada simples (v1)

export const purchaseEntries = pgTable(
  "purchase_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    status: purchaseStatusEnum("status").notNull().default("OPEN"),
    documentNumber: text("document_number"),
    entryDate: date("entry_date", { mode: "date" }).notNull().default(sql`current_date`),
    total: numeric("total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    installments: integer("installments").notNull().default(1),
    notes: text("notes"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    foreignKey({
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: "purchase_entries_supplier_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "purchase_entries_warehouse_fk",
    }).onDelete("restrict"),
    unique("purchase_entries_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("purchase_entries_tenant_number_uq").on(t.tenantId, t.number),
    index("purchase_entries_tenant_status_idx").on(t.tenantId, t.status),
    index("purchase_entries_tenant_supplier_idx").on(t.tenantId, t.supplierId),
  ],
);

export const purchaseEntryItems = pgTable(
  "purchase_entry_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    purchaseEntryId: uuid("purchase_entry_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchNumber: text("batch_number"),
    expiresAt: date("expires_at", { mode: "date" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull(),
    totalCost: numeric("total_cost", { precision: 14, scale: 2 })
      .generatedAlwaysAs(sql`quantity * unit_cost`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.purchaseEntryId],
      foreignColumns: [purchaseEntries.tenantId, purchaseEntries.id],
      name: "purchase_entry_items_entry_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "purchase_entry_items_product_fk",
    }).onDelete("restrict"),
    check("purchase_entry_items_quantity_positive", sql`quantity > 0`),
    check("purchase_entry_items_unit_cost_non_negative", sql`unit_cost >= 0`),
    index("purchase_entry_items_tenant_entry_idx").on(
      t.tenantId,
      t.purchaseEntryId,
    ),
  ],
);
