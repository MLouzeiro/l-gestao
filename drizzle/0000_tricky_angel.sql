CREATE TYPE "public"."cost_method" AS ENUM('MEDIO', 'FIFO');--> statement-breakpoint
CREATE TYPE "public"."financial_direction" AS ENUM('PAYABLE', 'RECEIVABLE');--> statement-breakpoint
CREATE TYPE "public"."financial_source" AS ENUM('SALE', 'PURCHASE', 'RETURN', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."financial_status" AS ENUM('OPEN', 'OVERDUE', 'PAID', 'PARTIAL', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('ENTRADA_COMPRA', 'ENTRADA_DEVOLUCAO', 'ENTRADA_AJUSTE', 'SAIDA_VENDA', 'SAIDA_DEVOLUCAO_FORNECEDOR', 'SAIDA_PERDA', 'SAIDA_QUEBRA', 'SAIDA_VENCIMENTO', 'SAIDA_AJUSTE', 'TRANSFERENCIA_SAIDA', 'TRANSFERENCIA_ENTRADA');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('ACTIVE', 'INACTIVE', 'DISCONTINUED');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('OPEN', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('DRAFT', 'CONFIRMED', 'BILLED', 'CANCELLED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."tenant_segment" AS ENUM('COMERCIO_GERAL', 'FARMACIA', 'LABORATORIO', 'SAUDE', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('TRIAL', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"max_users" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"controle_lote" boolean DEFAULT false NOT NULL,
	"controle_validade" boolean DEFAULT false NOT NULL,
	"controle_fabricacao" boolean DEFAULT false NOT NULL,
	"controle_receita" boolean DEFAULT false NOT NULL,
	"controle_fefo" boolean DEFAULT false NOT NULL,
	"controle_variacoes" boolean DEFAULT false NOT NULL,
	"controle_kits" boolean DEFAULT false NOT NULL,
	"multiplos_depositos" boolean DEFAULT false NOT NULL,
	"reserva_estoque" boolean DEFAULT true NOT NULL,
	"bloqueio_venda_vencido" boolean DEFAULT false NOT NULL,
	"dias_alerta_validade" integer[] DEFAULT '{}'::int[] NOT NULL,
	"max_desconto_vendedor" numeric(5, 2) DEFAULT '0' NOT NULL,
	"max_desconto_gerente" numeric(5, 2) DEFAULT '0' NOT NULL,
	"expira_reserva_horas" integer DEFAULT 24 NOT NULL,
	"custo_metodo" "cost_method" DEFAULT 'MEDIO' NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"legal_name" text,
	"trading_name" text,
	"document" text,
	"segment" "tenant_segment" DEFAULT 'COMERCIO_GERAL' NOT NULL,
	"address" jsonb,
	"status" "tenant_status" DEFAULT 'TRIAL' NOT NULL,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "brands_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "categories_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"document" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"barcode" text,
	"category_id" uuid,
	"brand_id" uuid,
	"unit_id" uuid,
	"cost_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sale_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin" numeric(8, 2) GENERATED ALWAYS AS (((sale_price - cost_price) / NULLIF(cost_price, 0)) * 100) STORED,
	"min_stock" numeric(14, 3) DEFAULT '0' NOT NULL,
	"max_stock" numeric(14, 3),
	"track_batch" boolean DEFAULT false NOT NULL,
	"requires_prescription" boolean DEFAULT false NOT NULL,
	"is_kit" boolean DEFAULT false NOT NULL,
	"status" "product_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"document" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suppliers_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "warehouses_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "batch_balances" (
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_balances_tenant_id_batch_id_warehouse_id_pk" PRIMARY KEY("tenant_id","batch_id","warehouse_id"),
	CONSTRAINT "batch_balances_quantity_non_negative" CHECK (quantity >= 0)
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"manufactured_at" date,
	"expires_at" date,
	"supplier_id" uuid,
	"entry_document" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"user_id" uuid,
	"notes" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventories_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventory_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"system_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(14, 3),
	"difference" numeric(14, 3) GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reserved" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_tenant_id_product_id_warehouse_id_pk" PRIMARY KEY("tenant_id","product_id","warehouse_id"),
	CONSTRAINT "stock_balances_quantity_non_negative" CHECK (quantity >= 0),
	CONSTRAINT "stock_balances_reserved_range" CHECK (reserved >= 0 AND reserved <= quantity)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid,
	"batch_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"transfer_id" uuid,
	"user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"notes" text,
	"document_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_positive" CHECK (quantity > 0),
	CONSTRAINT "stock_movements_unit_cost_non_negative" CHECK (unit_cost >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"status" "reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"user_id" uuid,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "purchase_status" DEFAULT 'OPEN' NOT NULL,
	"document_number" text,
	"entry_date" date DEFAULT current_date NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_entries_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_entry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_entry_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_number" text,
	"expires_at" date,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 2) NOT NULL,
	"total_cost" numeric(14, 2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_entry_items_quantity_positive" CHECK (quantity > 0),
	CONSTRAINT "purchase_entry_items_unit_cost_non_negative" CHECK (unit_cost >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(14, 2) GENERATED ALWAYS AS (quantity * unit_price - discount) STORED,
	"returned_quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_items_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_order_items_quantity_positive" CHECK (quantity > 0),
	CONSTRAINT "sales_order_items_returned_range" CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
	CONSTRAINT "sales_order_items_discount_non_negative" CHECK (discount >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"seller_id" uuid,
	"status" "sale_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"item_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"order_discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"billed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "sales_orders_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_return_id" uuid NOT NULL,
	"sales_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_return_items_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counters_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" "financial_direction" NOT NULL,
	"source" "financial_source" NOT NULL,
	"source_id" uuid,
	"description" text NOT NULL,
	"due_date" date NOT NULL,
	"installment_number" integer,
	"installment_count" integer,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "financial_status" DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "financial_accounts_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "financial_accounts_amount_positive" CHECK (amount > 0),
	CONSTRAINT "financial_accounts_paid_range" CHECK (paid_amount >= 0 AND paid_amount <= amount)
);
--> statement-breakpoint
CREATE TABLE "financial_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"financial_account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"interest" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_method" text NOT NULL,
	"paid_at" date DEFAULT current_date NOT NULL,
	"received_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_payments_amount_positive" CHECK (amount > 0),
	CONSTRAINT "financial_payments_interest_non_negative" CHECK (interest >= 0),
	CONSTRAINT "financial_payments_discount_non_negative" CHECK (discount >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"ip" text,
	"user_agent" text,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_result_valid" CHECK (result IN ('SUCCESS', 'FAILURE'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_tenants_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_tenants_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_kit_fk" FOREIGN KEY ("tenant_id","kit_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_fk" FOREIGN KEY ("tenant_id","component_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_balances" ADD CONSTRAINT "batch_balances_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."batches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_balances" ADD CONSTRAINT "batch_balances_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_fk" FOREIGN KEY ("tenant_id","inventory_id") REFERENCES "public"."inventories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_warehouse_fk" FOREIGN KEY ("tenant_id","to_warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."batches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "public"."transfers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."batches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_warehouse_fk" FOREIGN KEY ("tenant_id","from_warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_warehouse_fk" FOREIGN KEY ("tenant_id","to_warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entry_items" ADD CONSTRAINT "purchase_entry_items_entry_fk" FOREIGN KEY ("tenant_id","purchase_entry_id") REFERENCES "public"."purchase_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entry_items" ADD CONSTRAINT "purchase_entry_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_fk" FOREIGN KEY ("tenant_id","sales_order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."batches"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_seller_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_fk" FOREIGN KEY ("tenant_id","sales_return_id") REFERENCES "public"."sales_returns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_item_fk" FOREIGN KEY ("tenant_id","sales_item_id") REFERENCES "public"."sales_order_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_order_fk" FOREIGN KEY ("tenant_id","sales_order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_account_fk" FOREIGN KEY ("tenant_id","financial_account_id") REFERENCES "public"."financial_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_received_by_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factors_user_method_uq" ON "two_factors" USING btree ("user_id","method");--> statement-breakpoint
CREATE INDEX "tenant_settings_tenant_idx" ON "tenant_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_document_uq" ON "tenants" USING btree ("document") WHERE document IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_email_uq" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_user_uq" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "members_org_idx" ON "members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_uq" ON "roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_tenant_name_uq" ON "brands" USING btree ("tenant_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "brands_tenant_idx" ON "brands" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tenant_name_uq" ON "categories" USING btree ("tenant_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "categories_tenant_idx" ON "categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_document_uq" ON "customers" USING btree ("tenant_id","document") WHERE document IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_components_uq" ON "product_components" USING btree ("tenant_id","kit_id","component_id");--> statement-breakpoint
CREATE INDEX "product_components_tenant_idx" ON "product_components" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_uq" ON "products" USING btree ("tenant_id","sku") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_tenant_barcode_idx" ON "products" USING btree ("tenant_id","barcode") WHERE barcode IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_tenant_status_idx" ON "products" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_document_uq" ON "suppliers" USING btree ("tenant_id","document") WHERE document IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_tenant_code_uq" ON "warehouses" USING btree ("tenant_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "warehouses_tenant_idx" ON "warehouses" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_tenant_product_number_uq" ON "batches" USING btree ("tenant_id","product_id","batch_number");--> statement-breakpoint
CREATE INDEX "batches_tenant_expires_idx" ON "batches" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "batches_tenant_product_idx" ON "batches" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "inventories_tenant_idx" ON "inventories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_no_batch_uq" ON "inventory_items" USING btree ("tenant_id","inventory_id","product_id") WHERE batch_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_batch_uq" ON "inventory_items" USING btree ("tenant_id","inventory_id","product_id","batch_id") WHERE batch_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_inventory_idx" ON "inventory_items" USING btree ("tenant_id","inventory_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_product_occurred_idx" ON "stock_movements" USING btree ("tenant_id","product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_warehouse_occurred_idx" ON "stock_movements" USING btree ("tenant_id","warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_reference_idx" ON "stock_movements" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_transfer_idx" ON "stock_movements" USING btree ("tenant_id","transfer_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_status_expires_idx" ON "stock_reservations" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_reference_idx" ON "stock_reservations" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "transfers_tenant_idx" ON "transfers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_entries_tenant_number_uq" ON "purchase_entries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_entries_tenant_status_idx" ON "purchase_entries" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_entries_tenant_supplier_idx" ON "purchase_entries" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_entry_items_tenant_entry_idx" ON "purchase_entry_items" USING btree ("tenant_id","purchase_entry_id");--> statement-breakpoint
CREATE INDEX "sales_order_items_tenant_order_idx" ON "sales_order_items" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_tenant_number_uq" ON "sales_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_status_idx" ON "sales_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_created_idx" ON "sales_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_return_items_tenant_return_idx" ON "sales_return_items" USING btree ("tenant_id","sales_return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_tenant_number_uq" ON "sales_returns" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "sales_returns_tenant_order_idx" ON "sales_returns" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_tenant_status_due_idx" ON "financial_accounts" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX "financial_accounts_tenant_source_idx" ON "financial_accounts" USING btree ("tenant_id","source","source_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_tenant_direction_idx" ON "financial_accounts" USING btree ("tenant_id","direction","due_date");--> statement-breakpoint
CREATE INDEX "financial_payments_tenant_account_idx" ON "financial_payments" USING btree ("tenant_id","financial_account_id");--> statement-breakpoint
CREATE INDEX "financial_payments_tenant_paid_at_idx" ON "financial_payments" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_action_idx" ON "audit_logs" USING btree ("tenant_id","action");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_user_idx" ON "audit_logs" USING btree ("tenant_id","user_id");