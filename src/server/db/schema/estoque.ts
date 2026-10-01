import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  primaryKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  movementTypeEnum,
  reservationStatusEnum,
} from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";
import { products, warehouses, suppliers } from "./cadastros";

// Estoque — livro de movimentações imutável + cache derivado.
// stock_movements: somente INSERT/SELECT (sem policy de UPDATE/DELETE).

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    batchNumber: text("batch_number").notNull(),
    manufacturedAt: date("manufactured_at", { mode: "date" }),
    expiresAt: date("expires_at", { mode: "date" }),
    supplierId: uuid("supplier_id"),
    entryDocument: text("entry_document"),
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
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "batches_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: "batches_supplier_fk",
    }).onDelete("set null"),
    unique("batches_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("batches_tenant_product_number_uq").on(
      t.tenantId,
      t.productId,
      t.batchNumber,
    ),
    index("batches_tenant_expires_idx").on(t.tenantId, t.expiresAt),
    index("batches_tenant_product_idx").on(t.tenantId, t.productId),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fromWarehouseId: uuid("from_warehouse_id").notNull(),
    toWarehouseId: uuid("to_warehouse_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.fromWarehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "transfers_from_warehouse_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.toWarehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "transfers_to_warehouse_fk",
    }).onDelete("restrict"),
    unique("transfers_tenant_id_uq").on(t.tenantId, t.id),
    index("transfers_tenant_idx").on(t.tenantId),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: movementTypeEnum("type").notNull(),
    productId: uuid("product_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    toWarehouseId: uuid("to_warehouse_id"),
    batchId: uuid("batch_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalCost: numeric("total_cost", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    transferId: uuid("transfer_id"),
    userId: uuid("user_id"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    reason: text("reason"),
    notes: text("notes"),
    documentUrl: text("document_url"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "stock_movements_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "stock_movements_warehouse_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.toWarehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "stock_movements_to_warehouse_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [batches.tenantId, batches.id],
      name: "stock_movements_batch_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.transferId],
      foreignColumns: [transfers.tenantId, transfers.id],
      name: "stock_movements_transfer_fk",
    }).onDelete("restrict"),
    check("stock_movements_quantity_positive", sql`quantity > 0`),
    check("stock_movements_unit_cost_non_negative", sql`unit_cost >= 0`),
    index("stock_movements_tenant_product_occurred_idx").on(
      t.tenantId,
      t.productId,
      t.occurredAt,
    ),
    index("stock_movements_tenant_warehouse_occurred_idx").on(
      t.tenantId,
      t.warehouseId,
      t.occurredAt,
    ),
    index("stock_movements_tenant_reference_idx").on(
      t.tenantId,
      t.referenceType,
      t.referenceId,
    ),
    index("stock_movements_tenant_transfer_idx").on(t.tenantId, t.transferId),
  ],
);

export const stockBalances = pgTable(
  "stock_balances",
  {
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    reserved: numeric("reserved", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.warehouseId] }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "stock_balances_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "stock_balances_warehouse_fk",
    }).onDelete("cascade"),
    check("stock_balances_quantity_non_negative", sql`quantity >= 0`),
    check(
      "stock_balances_reserved_range",
      sql`reserved >= 0 AND reserved <= quantity`,
    ),
  ],
);

export const batchBalances = pgTable(
  "batch_balances",
  {
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.batchId, t.warehouseId] }),
    foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [batches.tenantId, batches.id],
      name: "batch_balances_batch_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "batch_balances_warehouse_fk",
    }).onDelete("cascade"),
    check("batch_balances_quantity_non_negative", sql`quantity >= 0`),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchId: uuid("batch_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    status: reservationStatusEnum("status").notNull().default("ACTIVE"),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    expiresAt: timestamp("expires_at", {
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
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "stock_reservations_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "stock_reservations_warehouse_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [batches.tenantId, batches.id],
      name: "stock_reservations_batch_fk",
    }).onDelete("cascade"),
    check("stock_reservations_quantity_positive", sql`quantity > 0`),
    index("stock_reservations_tenant_status_expires_idx").on(
      t.tenantId,
      t.status,
      t.expiresAt,
    ),
    index("stock_reservations_tenant_reference_idx").on(
      t.tenantId,
      t.referenceType,
      t.referenceId,
    ),
  ],
);

export const inventories = pgTable(
  "inventories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    appliedAt: timestamp("applied_at", {
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
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "inventories_warehouse_fk",
    }).onDelete("restrict"),
    unique("inventories_tenant_id_uq").on(t.tenantId, t.id),
    index("inventories_tenant_idx").on(t.tenantId),
  ],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    inventoryId: uuid("inventory_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchId: uuid("batch_id"),
    systemQty: numeric("system_qty", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    countedQty: numeric("counted_qty", { precision: 14, scale: 3 }),
    difference: numeric("difference", { precision: 14, scale: 3 })
      .generatedAlwaysAs(sql`counted_qty - system_qty`),
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
      columns: [t.tenantId, t.inventoryId],
      foreignColumns: [inventories.tenantId, inventories.id],
      name: "inventory_items_inventory_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "inventory_items_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [batches.tenantId, batches.id],
      name: "inventory_items_batch_fk",
    }).onDelete("restrict"),
    uniqueIndex("inventory_items_no_batch_uq")
      .on(t.tenantId, t.inventoryId, t.productId)
      .where(sql`batch_id IS NULL`),
    uniqueIndex("inventory_items_batch_uq")
      .on(t.tenantId, t.inventoryId, t.productId, t.batchId)
      .where(sql`batch_id IS NOT NULL`),
    index("inventory_items_tenant_inventory_idx").on(t.tenantId, t.inventoryId),
  ],
);
