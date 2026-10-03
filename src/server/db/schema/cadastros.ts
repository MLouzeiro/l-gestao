import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productStatusEnum, warehouseTypeEnum } from "./enums";
import { tenants } from "./tenancy";
import { users } from "./auth";

// Cadastros — RLS em todas as tabelas com tenant_id.

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: warehouseTypeEnum("type").notNull().default("MATRIZ"),
    // FK (tenant_id, parent_id) → warehouses: adicionada na migration custom
    // (auto-referência circular não é suportada pela tipagem do Drizzle).
    parentId: uuid("parent_id"),
    managerUserId: uuid("manager_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    isDefault: boolean("is_default").notNull().default(false),
    address: jsonb("address"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    unique("warehouses_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("warehouses_tenant_code_uq")
      .on(t.tenantId, t.code)
      .where(sql`deleted_at IS NULL`),
    index("warehouses_tenant_idx").on(t.tenantId),
    index("warehouses_tenant_parent_idx").on(t.tenantId, t.parentId),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  // FK (tenant_id, parent_id) → categories: adicionada na migration custom
  // (auto-referência circular não é suportada pela tipagem do Drizzle).
  (t) => [
    unique("categories_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("categories_tenant_name_uq")
      .on(t.tenantId, t.name)
      .where(sql`deleted_at IS NULL`),
    index("categories_tenant_idx").on(t.tenantId),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    unique("brands_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("brands_tenant_name_uq")
      .on(t.tenantId, t.name)
      .where(sql`deleted_at IS NULL`),
    index("brands_tenant_idx").on(t.tenantId),
  ],
);

// Unidades globais (decisão aprovada — sem tenant_id, sem RLS)
export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull().default(0),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull().defaultNow(),
});

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    document: text("document"),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    unique("suppliers_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("suppliers_tenant_document_uq")
      .on(t.tenantId, t.document)
      .where(sql`document IS NOT NULL AND deleted_at IS NULL`),
    index("suppliers_tenant_idx").on(t.tenantId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    document: text("document"),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address"),
    notes: text("notes"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    unique("customers_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("customers_tenant_document_uq")
      .on(t.tenantId, t.document)
      .where(sql`document IS NOT NULL AND deleted_at IS NULL`),
    index("customers_tenant_idx").on(t.tenantId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    barcode: text("barcode"),
    categoryId: uuid("category_id"),
    brandId: uuid("brand_id"),
    unitId: uuid("unit_id"),
    costPrice: numeric("cost_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    salePrice: numeric("sale_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    margin: numeric("margin", { precision: 8, scale: 2 }).generatedAlwaysAs(
      sql`((sale_price - cost_price) / NULLIF(cost_price, 0)) * 100`,
    ),
    minStock: numeric("min_stock", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    maxStock: numeric("max_stock", { precision: 14, scale: 3 }),
    trackBatch: boolean("track_batch").notNull().default(false),
    requiresPrescription: boolean("requires_prescription")
      .notNull()
      .default(false),
    isKit: boolean("is_kit").notNull().default(false),
    status: productStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  // FK (tenant_id, parent_id) → products: adicionada na migration custom
  // (auto-referência circular não é suportada pela tipagem do Drizzle).
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
      name: "products_category_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.tenantId, t.brandId],
      foreignColumns: [brands.tenantId, brands.id],
      name: "products_brand_fk",
    }).onDelete("set null"),
    unique("products_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("products_tenant_sku_uq")
      .on(t.tenantId, t.sku)
      .where(sql`deleted_at IS NULL`),
    index("products_tenant_barcode_idx")
      .on(t.tenantId, t.barcode)
      .where(sql`barcode IS NOT NULL AND deleted_at IS NULL`),
    index("products_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const productComponents = pgTable(
  "product_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kitId: uuid("kit_id").notNull(),
    componentId: uuid("component_id").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 })
      .notNull()
      .default("1"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.kitId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_components_kit_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.componentId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_components_component_fk",
    }).onDelete("cascade"),
    uniqueIndex("product_components_uq").on(t.tenantId, t.kitId, t.componentId),
    index("product_components_tenant_idx").on(t.tenantId),
  ],
);

// Estoque-alvo por unidade/produto (mínimo, máximo, ponto de reposição).
export const warehouseProductTargets = pgTable(
  "warehouse_product_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
    productId: uuid("product_id").notNull(),
    minQty: numeric("min_qty", { precision: 14, scale: 3 }),
    maxQty: numeric("max_qty", { precision: 14, scale: 3 }),
    reorderPoint: numeric("reorder_point", { precision: 14, scale: 3 }),
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
    unique("warehouse_product_targets_tenant_id_uq").on(t.tenantId, t.id),
    unique("warehouse_product_targets_wh_product_uq").on(
      t.tenantId,
      t.warehouseId,
      t.productId,
    ),
    index("warehouse_product_targets_tenant_wh_idx").on(
      t.tenantId,
      t.warehouseId,
    ),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "warehouse_product_targets_warehouse_fk",
    }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "warehouse_product_targets_product_fk",
    }),
  ],
);

// Acesso explícito por usuário — sem linhas = acesso amplo por padrão;
// com linhas, o usuário vê as próprias unidades + descendentes (herança).
export const warehouseMembers = pgTable(
  "warehouse_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    unique("warehouse_members_tenant_id_uq").on(t.tenantId, t.id),
    unique("warehouse_members_wh_user_uq").on(
      t.tenantId,
      t.warehouseId,
      t.userId,
    ),
    index("warehouse_members_user_idx").on(t.tenantId, t.userId),
    foreignKey({
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
      name: "warehouse_members_warehouse_fk",
    }),
  ],
);
