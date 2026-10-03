-- 0009_units_hierarchy.sql
-- E3 Unidades (PROMPT MESTRE): warehouses ganham tipo (MATRIZ/FILIAL/POSTO),
-- hierarquia (parent_id) e responsável; estoque-alvo por unidade/produto;
-- acesso explícito por usuário (warehouse_members).
-- 100% aditivo — sem DROP/TRUNCATE/remoção.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
CREATE TYPE "warehouse_type" AS ENUM ('MATRIZ', 'FILIAL', 'POSTO');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Unidades: tipo + hierarquia + responsável
-- ---------------------------------------------------------------------------
ALTER TABLE "warehouses"
  ADD COLUMN "type" "warehouse_type" NOT NULL DEFAULT 'MATRIZ',
  ADD COLUMN "parent_id" uuid,
  ADD COLUMN "manager_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

-- FK auto-referente (padrão categories/0001: o Drizzle não tipa auto-referência)
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_parent_fk"
  FOREIGN KEY (tenant_id, parent_id) REFERENCES "warehouses" (tenant_id, id)
  ON DELETE set null;
--> statement-breakpoint

CREATE INDEX "warehouses_tenant_parent_idx" ON "warehouses" ("tenant_id", "parent_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Estoque-alvo por unidade/produto (mínimo, máximo, ponto de reposição)
-- ---------------------------------------------------------------------------
CREATE TABLE "warehouse_product_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "warehouse_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "min_qty" numeric(14, 3),
  "max_qty" numeric(14, 3),
  "reorder_point" numeric(14, 3),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "warehouse_product_targets_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "warehouse_product_targets_wh_product_uq" UNIQUE ("tenant_id", "warehouse_id", "product_id"),
  CONSTRAINT "warehouse_product_targets_warehouse_fk"
    FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses" ("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "warehouse_product_targets_product_fk"
    FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products" ("tenant_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "warehouse_product_targets_tenant_wh_idx"
  ON "warehouse_product_targets" ("tenant_id", "warehouse_id");

-- ---------------------------------------------------------------------------
-- Acesso explícito por usuário (sem linhas = acesso amplo por padrão)
-- ---------------------------------------------------------------------------
CREATE TABLE "warehouse_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "warehouse_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "warehouse_members_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "warehouse_members_wh_user_uq" UNIQUE ("tenant_id", "warehouse_id", "user_id"),
  CONSTRAINT "warehouse_members_warehouse_fk"
    FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses" ("tenant_id", "id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "warehouse_members_user_idx" ON "warehouse_members" ("tenant_id", "user_id");

-- ---------------------------------------------------------------------------
-- RLS — isolamento multi-tenant (padrão 0001/0007/0008): ENABLE + FORCE
-- ---------------------------------------------------------------------------
ALTER TABLE "warehouse_product_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouse_product_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouse_product_targets"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "warehouse_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouse_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouse_members"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Permissões novas (catálogo global) + matriz por papel (backfill tenants)
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('units.view', 'units', 'Visualizar unidades e estrutura'),
  ('units.manage', 'units', 'Gerenciar unidades, acesso e estoque-alvo')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('units.view', 'units.manage')
WHERE r."key" = 'ADMIN'
   OR r."key" = 'GERENTE'
   OR r."key" = 'ESTOQUISTA'
   OR (r."key" = 'FINANCEIRO' AND p."key" = 'units.view')
   OR (r."key" = 'VISUALIZADOR' AND p."key" = 'units.view')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grants da aplicação (padrão 0005)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON warehouse_product_targets TO estoque_app';
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON warehouse_members TO estoque_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app';
  END IF;
END $$;
