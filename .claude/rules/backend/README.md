# Regras de Backend (Server Actions, Drizzle, RLS)

Aplica para: `src/server/**`, `src/actions/**`, `src/app/api/**`, `drizzle/**`

## withTenant (obrigatório)
- Todo acesso a dados roda dentro de `withTenant(tenantId, userId, async (tx) => { ... })`.
- `withTenant` abre `db.transaction`, faz `SET LOCAL app.current_tenant_id` e `app.current_user_id`, e entrega um `tx` (Drizzle) para as queries.
- Nunca usar o client `db` fora do helper; nunca abrir transação manual para "otimizar".

## RLS
- Policies `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)` — fail-closed.
- A aplicação **também** filtra por `tenant_id` (defesa em profundidade) — as duas camadas sempre.
- Nenhuma migration pode desabilitar RLS em tabela de negócio.

## Livro de estoque
- Escrita de saldo só via `applyMovement()` — grava `stock_movements` e atualiza `stock_balances`/`batch_balances` na mesma transação.
- Nunca `UPDATE stock_balances.quantity` direto; nunca `DELETE FROM stock_movements`.
- Correção = novo movimento (`*_AJUSTE` ou estorno vinculado ao `reference_id` original).

## Máquina de estados de venda
- Transições validadas no serviço: `DRAFT→CONFIRMED→BILLED`; `CANCELLED` libera reserva; pós-`BILLED` imutável.
- Faturar = baixa de estoque + movimentação + parcelas a receber, tudo na mesma transação.

## Financeiro
- Parcelas geradas pelo serviço (nunca montadas no cliente).
- `paid_amount ≤ amount` (CHECK + validação); status recalculado a cada baixa.

## Validação e segurança
- Zod em toda entrada; `requirePermission()` antes de qualquer mutação.
- Soft delete (`deleted_at`) em produtos/clientes/fornecedores — nunca DELETE físico (exceto dados de teste).
- Numeração de documentos só via `counters` com lock (`SELECT … FOR UPDATE`).

## Auditoria
- Toda mutação sensível chama `audit({ action, module, entityType, entityId, before, after })` dentro da mesma transação.
