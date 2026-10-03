-- 0008_modules_billing.sql
-- Núcleo SaaS (PROMPT MESTRE §4/§35): módulos contratáveis por empresa,
-- plano → módulos, assinatura e versão de contrato aceita.
-- 100% aditivo — sem DROP/TRUNCATE/remoção (§2/§49).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED');
--> statement-breakpoint
ALTER TYPE "tenant_segment" ADD VALUE IF NOT EXISTS 'LANCHONETE';
--> statement-breakpoint
ALTER TYPE "tenant_segment" ADD VALUE IF NOT EXISTS 'FRIGORIFICO';

-- ---------------------------------------------------------------------------
-- Catálogo global de módulos (sem RLS — dado estático como plans/permissions)
-- ---------------------------------------------------------------------------
CREATE TABLE "modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "plan_modules" (
  "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE cascade,
  "module_id" uuid NOT NULL REFERENCES "modules"("id") ON DELETE cascade,
  CONSTRAINT "plan_modules_pk" PRIMARY KEY ("plan_id", "module_id")
);

-- ---------------------------------------------------------------------------
-- Contratação por empresa (RLS)
-- ---------------------------------------------------------------------------
CREATE TABLE "tenant_modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "module_id" uuid NOT NULL REFERENCES "modules"("id") ON DELETE restrict,
  "active" boolean DEFAULT true NOT NULL,
  "contracted_at" timestamptz DEFAULT now() NOT NULL,
  "contracted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_modules_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "tenant_modules_tenant_module_uq" UNIQUE ("tenant_id", "module_id")
);
--> statement-breakpoint
CREATE INDEX "tenant_modules_tenant_active_idx" ON "tenant_modules" ("tenant_id", "active");

CREATE TABLE "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "plan_id" uuid REFERENCES "plans"("id") ON DELETE set null,
  "status" "subscription_status" DEFAULT 'TRIAL' NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "current_period_end" timestamptz,
  "canceled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "subscriptions_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "subscriptions_tenant_uq" UNIQUE ("tenant_id")
);
--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_status_idx" ON "subscriptions" ("tenant_id", "status");

CREATE TABLE "tenant_contract_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "version" text NOT NULL,
  "content_hash" text NOT NULL,
  "accepted_at" timestamptz DEFAULT now() NOT NULL,
  "accepted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "tenant_contract_versions_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "tenant_contract_versions_uq" UNIQUE ("tenant_id", "version")
);
--> statement-breakpoint
CREATE INDEX "tenant_contract_versions_tenant_idx" ON "tenant_contract_versions" ("tenant_id", "accepted_at");

-- ---------------------------------------------------------------------------
-- RLS — isolamento multi-tenant (padrão 0001/0007): ENABLE + FORCE
-- ---------------------------------------------------------------------------
ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_modules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_modules"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "tenant_contract_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_contract_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_contract_versions"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Catálogo inicial de módulos (idempotente)
-- ---------------------------------------------------------------------------
INSERT INTO "modules" ("key", "name", "description") VALUES
  ('ESTOQUE', 'Estoque', 'Produtos, saldos e movimentações'),
  ('COMPRAS', 'Compras', 'Notas de entrada e contas a pagar'),
  ('VENDAS', 'Vendas', 'Pedidos, faturamento e devoluções'),
  ('PDV', 'PDV / Caixa', 'Frente de caixa, caixa e PIX'),
  ('FINANCEIRO', 'Financeiro', 'Contas a receber e a pagar'),
  ('INVENTARIO', 'Inventário', 'Contagens e ajustes de estoque'),
  ('LOTES_VALIDADE', 'Lotes e Validade', 'Rastreio por lote e alertas de vencimento'),
  ('MATRIZ_POSTOS', 'Matriz e Postos', 'Unidades, filiais e postos de coleta'),
  ('TRANSFERENCIAS', 'Transferências', 'Envio entre unidades com workflow e recebimento'),
  ('REPOSICAO', 'Reposição', 'Requisições de reposição entre unidades'),
  ('AUDITORIA', 'Auditoria', 'Central de auditoria e eventos de segurança'),
  ('INDICADORES', 'Indicadores', 'Painéis, alertas e indicadores por segmento'),
  ('RELATORIOS', 'Relatórios', 'Relatórios exportáveis')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Backfill: empresas existentes continuam com tudo que já usavam (§2)
INSERT INTO "tenant_modules" ("tenant_id", "module_id")
SELECT t."id", m."id" FROM "tenants" t CROSS JOIN "modules" m
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "subscriptions" ("tenant_id", "status")
SELECT "id", 'ACTIVE' FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grants da aplicação (padrão 0005)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT SELECT ON modules TO estoque_app';
    EXECUTE 'GRANT SELECT ON plan_modules TO estoque_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_modules TO estoque_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO estoque_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_contract_versions TO estoque_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app';
  END IF;
END $$;
