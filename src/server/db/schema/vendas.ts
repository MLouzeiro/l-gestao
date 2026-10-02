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
import { saleStatusEnum } from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";
import { customers, products, warehouses } from "./cadastros";
import { batches } from "./estoque";

// Vendas — máquina de estados DRAFT → CONFIRMED → BILLED (imutável após)

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    sellerId: uuid("seller_id"),
    status: saleStatusEnum("status").notNull().default("DRAFT"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    itemDiscount: numeric("item_discount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    orderDiscount: numeric("order_discount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    installments: integer("installments").notNull().default(1),
    notes: text("notes"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    billedAt: timestamp("billed_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: "sales_orders_customer_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "sales_orders_warehouse_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.sellerId],
      foreignColumns: [users.id],
      name: "sales_orders_seller_fk",
    }).onDelete("set null"),
    unique("sales_orders_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("sales_orders_tenant_number_uq").on(t.tenantId, t.number),
    index("sales_orders_tenant_status_idx").on(t.tenantId, t.status),
    index("sales_orders_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("sales_orders_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    salesOrderId: uuid("sales_order_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchId: uuid("batch_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 })
      .generatedAlwaysAs(sql`quantity * unit_price - discount`),
    returnedQuantity: numeric("returned_quantity", {
      precision: 14,
      scale: 3,
    }).notNull().default("0"),
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
      columns: [t.tenantId, t.salesOrderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
      name: "sales_order_items_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "sales_order_items_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [batches.tenantId, batches.id],
      name: "sales_order_items_batch_fk",
    }).onDelete("set null"),
    unique("sales_order_items_tenant_id_uq").on(t.tenantId, t.id),
    check("sales_order_items_quantity_positive", sql`quantity > 0`),
    check(
      "sales_order_items_returned_range",
      sql`returned_quantity >= 0 AND returned_quantity <= quantity`,
    ),
    check("sales_order_items_discount_non_negative", sql`discount >= 0`),
    index("sales_order_items_tenant_order_idx").on(t.tenantId, t.salesOrderId),
  ],
);

export const salesReturns = pgTable(
  "sales_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    salesOrderId: uuid("sales_order_id").notNull(),
    customerId: uuid("customer_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    total: numeric("total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.salesOrderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
      name: "sales_returns_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: "sales_returns_customer_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "sales_returns_warehouse_fk",
    }).onDelete("restrict"),
    unique("sales_returns_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("sales_returns_tenant_number_uq").on(t.tenantId, t.number),
    index("sales_returns_tenant_order_idx").on(t.tenantId, t.salesOrderId),
  ],
);

export const salesReturnItems = pgTable(
  "sales_return_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    salesReturnId: uuid("sales_return_id").notNull(),
    salesItemId: uuid("sales_item_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchId: uuid("batch_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    total: numeric("total", { precision: 14, scale: 2 })
      .generatedAlwaysAs(sql`quantity * unit_price`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.salesReturnId],
      foreignColumns: [salesReturns.tenantId, salesReturns.id],
      name: "sales_return_items_return_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.salesItemId],
      foreignColumns: [salesOrderItems.tenantId, salesOrderItems.id],
      name: "sales_return_items_item_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "sales_return_items_product_fk",
    }).onDelete("restrict"),
    check("sales_return_items_quantity_positive", sql`quantity > 0`),
    index("sales_return_items_tenant_return_idx").on(
      t.tenantId,
      t.salesReturnId,
    ),
  ],
);
