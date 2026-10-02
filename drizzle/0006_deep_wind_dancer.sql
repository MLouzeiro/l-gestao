ALTER TABLE "purchase_entries" ADD COLUMN "installments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "installments" integer DEFAULT 1 NOT NULL;