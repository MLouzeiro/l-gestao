-- 0001_rls_tenant_isolation.sql
-- Isolamento multi-tenant (docs/ARQUITETURA.md §4) + FKs auto-referentes.
--
-- Padrão: ENABLE + FORCE (mesmo o dono da tabela — a aplicação — fica sujeito
-- às policies; sem SET LOCAL app.current_tenant_id a query devolve 0 linhas).
-- Sem `SET LOCAL` (nunca `SET` de sessão): fail-closed por transação.
--
-- Sem RLS (global ou validação na aplicação, conforme §4):
--   plans, permissions, units (globais) · users, sessions, accounts,
--   verifications, two_factors (auth/login) · tenants, members, invitations
--   (Better Auth escreve direto; membership validado na aplicação).

-- ---------------------------------------------------------------------------
-- FKs auto-referentes (não suportadas pela tipagem do Drizzle — ver cadastros.ts)
-- ---------------------------------------------------------------------------
ALTER TABLE categories
  ADD CONSTRAINT categories_parent_fk
  FOREIGN KEY (tenant_id, parent_id) REFERENCES categories (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE products
  ADD CONSTRAINT products_parent_fk
  FOREIGN KEY (tenant_id, parent_id) REFERENCES products (tenant_id, id)
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento total (SELECT/INSERT/UPDATE/DELETE)
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- role_permissions não tem tenant_id: herda o tenant do papel (subquery).
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (
    role_id IN (
      SELECT id FROM roles
      WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    role_id IN (
      SELECT id FROM roles
      WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warehouses
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brands
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE product_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_components
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON batches
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transfers
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_balances
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE batch_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON batch_balances
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_reservations
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventories
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE purchase_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_entries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE purchase_entry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_entry_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_entry_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_orders
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_returns
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_return_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_return_items
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON financial_accounts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON counters
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Imutáveis: somente INSERT/SELECT (sem policy de UPDATE/DELETE — correção é
-- estorno/lançamento novo; FORCE garante que nem o dono da tabela atualize).
-- ---------------------------------------------------------------------------
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON stock_movements
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON stock_movements
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE financial_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON financial_payments
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON financial_payments
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- audit_logs: append-only (somente INSERT/SELECT — LGPD: histórico nunca apagado)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON audit_logs
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY tenant_insert ON audit_logs
  FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
