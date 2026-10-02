import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { costMethodEnum, tenantSegmentEnum, tenantStatusEnum } from "./enums";

// Tenancy — tenants = organization do Better Auth estendida (sem RLS:
// membership validado na aplicação, conforme docs/ARQUITETURA.md §4)

export type Address = {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  zipcode?: string;
};

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  price: numeric("price", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  maxUsers: integer("max_users"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull().defaultNow(),
});

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    legalName: text("legal_name"),
    tradingName: text("trading_name"),
    document: text("document"),
    segment: tenantSegmentEnum("segment").notNull().default("COMERCIO_GERAL"),
    address: jsonb("address").$type<Address>(),
    status: tenantStatusEnum("status").notNull().default("TRIAL"),
    // Exigido pelo plugin de organizações do Better Auth (metadados livres)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
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
    uniqueIndex("tenants_document_uq")
      .on(t.document)
      .where(sql`document IS NOT NULL`),
  ],
);

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    controleLote: boolean("controle_lote").notNull().default(false),
    controleValidade: boolean("controle_validade").notNull().default(false),
    controleFabricacao: boolean("controle_fabricacao")
      .notNull()
      .default(false),
    controleReceita: boolean("controle_receita").notNull().default(false),
    controleFefo: boolean("controle_fefo").notNull().default(false),
    controleVariacoes: boolean("controle_variacoes").notNull().default(false),
    controleKits: boolean("controle_kits").notNull().default(false),
    multiplosDepositos: boolean("multiplos_depositos")
      .notNull()
      .default(false),
    reservaEstoque: boolean("reserva_estoque").notNull().default(true),
    bloqueioVendaVencido: boolean("bloqueio_venda_vencido")
      .notNull()
      .default(false),
    diasAlertaValidade: integer("dias_alerta_validade")
      .array()
      .notNull()
      .default(sql`'{}'::int[]`),
    maxDescontoVendedor: numeric("max_desconto_vendedor", {
      precision: 5,
      scale: 2,
    }).notNull().default("0"),
    maxDescontoGerente: numeric("max_desconto_gerente", {
      precision: 5,
      scale: 2,
    }).notNull().default("0"),
    expiraReservaHoras: integer("expira_reserva_horas")
      .notNull()
      .default(24),
    custoMetodo: costMethodEnum("custo_metodo")
      .notNull()
      .default("MEDIO"),
    pixKey: text("pix_key"),
    pixCity: text("pix_city"),
    extra: jsonb("extra").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [index("tenant_settings_tenant_idx").on(t.tenantId)],
);
