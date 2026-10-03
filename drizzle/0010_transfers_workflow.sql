-- 0010_transfers_workflow.sql
-- E4+E6 Transferências: fluxo simples (saída+entrada imediatas) e workflow
-- (DRAFT → SENT → RECEIVED / CANCELLED) com modo de baixa escolhível
-- (settle_on: SEND = baixa na origem ao enviar; RECEIVE = só ao receber).
-- 100% aditivo — sem DROP/TRUNCATE/remoção.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "transfer_status" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "transfer_settle_on" AS ENUM ('SEND', 'RECEIVE');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Transfers: workflow + numeração
-- ---------------------------------------------------------------------------
ALTER TABLE "transfers"
  ADD COLUMN "number" integer NOT NULL DEFAULT 0,
  ADD COLUMN "status" "transfer_status" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "settle_on" "transfer_settle_on" NOT NULL DEFAULT 'SEND',
  ADD COLUMN "sent_at" timestamptz,
  ADD COLUMN "received_at" timestamptz,
  ADD COLUMN "cancelled_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "transfers_tenant_status_idx" ON "transfers" ("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- Itens da transferência (produto, lote opcional, quantidade)
-- ---------------------------------------------------------------------------
CREATE TABLE "transfer_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "transfer_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "batch_number" text,
  "quantity" numeric(14, 3) NOT NULL,
  "unit_cost" numeric(14, 2) NOT NULL DEFAULT '0',
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "transfer_items_tenant_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "transfer_items_tenant_transfer_product_uq"
    UNIQUE ("tenant_id", "transfer_id", "product_id"),
  CONSTRAINT "transfer_items_transfer_fk"
    FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "transfers" ("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "transfer_items_product_fk"
    FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products" ("tenant_id", "id") ON DELETE restrict,
  CONSTRAINT "transfer_items_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX "transfer_items_transfer_idx" ON "transfer_items" ("tenant_id", "transfer_id");

-- ---------------------------------------------------------------------------
-- RLS — transfer_items (transfers já tem RLS na 0001)
-- ---------------------------------------------------------------------------
ALTER TABLE "transfer_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "transfer_items"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Grants da aplicação (padrão 0005)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_items TO estoque_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app';
  END IF;
END $$;
