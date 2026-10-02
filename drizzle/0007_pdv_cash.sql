-- 0007_pdv_cash.sql
-- PDV + Caixa (Etapa 3): forma de pagamento e origem na venda, chave PIX do
-- tenant e caixa (abertura/fechamento, suprimentos, sangrias).
--
-- cash_movements é livro-caixa imutável (append-only: só SELECT/INSERT na RLS),
-- no mesmo espírito de stock_movements/financial_payments.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "sale_payment_method" AS ENUM ('DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'VALE', 'OUTRO');
CREATE TYPE "sale_origin" AS ENUM ('PDV', 'VENDA', 'ONLINE', 'IMPORT');
CREATE TYPE "cash_status" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "cash_movement_type" AS ENUM ('ABERTURA', 'VENDA', 'SUPRIMENTO', 'SANGRIA', 'FECHAMENTO');

-- ---------------------------------------------------------------------------
-- Venda: pagamento persistido (antes só existia installments)
-- ---------------------------------------------------------------------------
ALTER TABLE "sales_orders" ADD COLUMN "payment_method" "sale_payment_method" DEFAULT 'DINHEIRO' NOT NULL;
ALTER TABLE "sales_orders" ADD COLUMN "origin" "sale_origin" DEFAULT 'VENDA' NOT NULL;

-- ---------------------------------------------------------------------------
-- Tenant: chave PIX para o QR de cobrança do PDV
-- ---------------------------------------------------------------------------
ALTER TABLE "tenant_settings" ADD COLUMN "pix_key" text;
ALTER TABLE "tenant_settings" ADD COLUMN "pix_city" text;

-- ---------------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------------
CREATE TABLE "cash_registers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "status" "cash_status" DEFAULT 'OPEN' NOT NULL,
  "opening_amount" numeric(14,2) DEFAULT '0' NOT NULL,
  "closing_amount" numeric(14,2),
  "counted_cash" numeric(14,2),
  "counted_card" numeric(14,2),
  "counted_pix" numeric(14,2),
  "counted_other" numeric(14,2),
  "expected_cash" numeric(14,2),
  "expected_card" numeric(14,2),
  "expected_pix" numeric(14,2),
  "expected_other" numeric(14,2),
  "difference" numeric(14,2),
  "opened_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "closed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "opened_at" timestamptz DEFAULT now() NOT NULL,
  "closed_at" timestamptz,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "cash_registers_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "cash_registers_tenant_number_uq" UNIQUE ("tenant_id", "number"),
  CONSTRAINT "cash_registers_opening_non_negative" CHECK ("opening_amount" >= 0)
);
--> statement-breakpoint
-- Só um caixa aberto por empresa
CREATE UNIQUE INDEX "cash_registers_tenant_open_uq"
  ON "cash_registers" ("tenant_id") WHERE "status" = 'OPEN';
--> statement-breakpoint
CREATE INDEX "cash_registers_tenant_status_idx" ON "cash_registers" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX "cash_registers_tenant_opened_idx" ON "cash_registers" ("tenant_id", "opened_at");
--> statement-breakpoint

CREATE TABLE "cash_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "cash_register_id" uuid NOT NULL,
  "type" "cash_movement_type" NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "payment_method" "sale_payment_method",
  "sale_id" uuid,
  "description" text,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "cash_movements_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "cash_movements_cash_register_fk" FOREIGN KEY ("tenant_id", "cash_register_id")
    REFERENCES "cash_registers" ("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "cash_movements_sale_fk" FOREIGN KEY ("tenant_id", "sale_id")
    REFERENCES "sales_orders" ("tenant_id", "id") ON DELETE set null,
  CONSTRAINT "cash_movements_amount_non_negative" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "cash_movements_tenant_register_idx" ON "cash_movements" ("tenant_id", "cash_register_id");
--> statement-breakpoint
CREATE INDEX "cash_movements_tenant_created_idx" ON "cash_movements" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "cash_movements_tenant_sale_idx" ON "cash_movements" ("tenant_id", "sale_id");

-- ---------------------------------------------------------------------------
-- RLS — isolamento multi-tenant (docs/ARQUITETURA.md §4): ENABLE + FORCE,
-- policy fail-closed com SET LOCAL app.current_tenant_id (comparar NULLIF).
-- ---------------------------------------------------------------------------
ALTER TABLE "cash_registers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_registers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_registers"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Livro-caixa imutável: sem policy de UPDATE/DELETE (correção é lançamento novo)
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON "cash_movements"
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON "cash_movements"
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Grants da aplicação (padrão 0005) — o ALTER DEFAULT PRIVILEGES da 0005 já
-- cobre tabelas novas; o GRANT explícito protege bancos onde o papel da app
-- precisa de grant direto (ex.: banco de teste).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cash_registers TO estoque_app';
    EXECUTE 'GRANT SELECT, INSERT ON cash_movements TO estoque_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app';
  END IF;
END $$;
