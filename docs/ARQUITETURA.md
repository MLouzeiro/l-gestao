# ARQUITETURA — Sistema SaaS Multi-Empresa: Estoque + Vendas + Financeiro

> Documento aprovado pelo responsável pelo projeto em 25/09/2026 (Fase 1).
> Fonte de verdade para todas as fases seguintes. Alterações devem ser editadas aqui primeiro.

---

## 1. Visão geral e escolhas centrais

| Área | Escolha | Por quê |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server Actions com autorização no servidor |
| Banco | **Neon (PostgreSQL serverless)** | Branch por PR (preview), RLS de primeira classe, integração Vercel |
| ORM | **Drizzle ORM** | Transações explícitas (essencial para RLS via `SET LOCAL`), migrations em SQL auditável, leve em serverless |
| Auth | **Better Auth** | Organizações multi-tenant, sessões revogáveis, 2FA, convites, adapter Drizzle oficial |
| UI | Tailwind CSS + shadcn/ui | Responsivo (balcão/tablet/celular) |
| Isolamento | `tenant_id` + **RLS no banco** + filtro na aplicação | Defesa em profundidade — regra fundamental do projeto |
| Testes | Jest + Testing Library | Alinhado ao harness `.claude/rules/tests` |

**Fluxo de uma requisição:**

```
Navegador (cookie httpOnly) → middleware (sessão + tenant ativo)
  → Server Action / Route Handler → requirePermission(...)  [RBAC no servidor]
  → withTenant(tenantId, userId, tx => …)  — transação ÚNICA
       ├── SET LOCAL app.current_tenant_id = '…'
       ├── SET LOCAL app.current_user_id   = '…'
       └── queries Drizzle (tenant_id também no WHERE = defesa em profundidade)
  → regras de domínio (saldo por movimentação, FEFO, limite de desconto)
  → audit_log (append-only) → commit
```

**Conceitos-chave:**
- `SET LOCAL` = "durante ESTA transação, o contexto é a empresa X". Sem ele, a RLS devolve 0 linhas (fail-closed).
- Saldo de estoque nunca é editado: é a soma do livro de movimentações (`stock_movements`).
- `tenant_id` **nunca** vem do frontend — sempre da sessão autenticada.

---

## 2. Modelo de dados

**Convenções:** identificadores em inglês, interface em pt-BR. `id` = uuid gerado no app. Timestamps = `timestamptz`. Dinheiro = `numeric(14,2)` no banco e centavos (`integer`) no TypeScript — nunca float. Quantidades = `numeric(14,3)`. Soft delete = `deleted_at` + índice parcial `WHERE deleted_at IS NULL`. **FKs de negócio são compostas `(tenant_id, id)`** — impedem referência cross-tenant no nível do banco.

### 2.1 Autenticação (global, sem tenant — Better Auth)
`users` (email unique), `sessions` (token unique, expires_at), `accounts`, `verifications`, `two_factors`.

### 2.2 Tenancy
- `tenants` (= organization do Better Auth estendida): name, legal_name, trading_name, document (CNPJ unique), segment enum (`COMERCIO_GERAL`,`FARMACIA`,`LABORATORIO`,`SAUDE`,`OUTRO`), endereço, logo, status (`TRIAL`,`ACTIVE`,`SUSPENDED`), plan_id.
- `tenant_settings`: flags booleanas `controle_lote, controle_validade, controle_fabricacao, controle_receita, controle_fefo, controle_variacoes, controle_kits, multiplos_depositos, reserva_estoque, bloqueio_venda_vencido` + `dias_alerta_validade int[]`, `max_desconto_vendedor/max_gerente numeric`, `expira_reserva_horas int`, `custo_metodo (MEDIO|FIFO)`, `extra jsonb`.
- `plans`: estrutural para cobrança futura.

### 2.3 RBAC
- `roles` (tenant_id, key) UNIQUE(tenant_id, key) — seeds: ADMIN, GERENTE, FINANCEIRO, ESTOQUISTA, VENDEDOR, VISUALIZADOR.
- `permissions` (key PK fixo: products.*, stock.*, sales.*, finance.*, users.*, reports.view, audit.view, settings.manage).
- `role_permissions` (role_id, permission_key) — pronta para papéis personalizados.
- `members` (org_id, user_id, role) — papel por empresa.
- `invitations` (org_id, email, role, token, status, expires_at).

### 2.4 Cadastros
- `warehouses` UNIQUE(tenant_id, code) · `categories` (hierárquica) · `brands` · `units` (global + custom).
- `suppliers`, `customers` — soft delete + UNIQUE(tenant_id, document) parcial.
- `products`: parent_id (variação = produto filho com SKU próprio), sku UNIQUE por tenant, barcode, category/brand/unit, cost_price (média móvel), sale_price, **margem = coluna gerada** sobre custo, min/max stock, track_batch, requires_prescription, is_kit, status (`ACTIVE`,`INACTIVE`,`DISCONTINUED`).
- `product_components` (kits): (kit_id, component_id) UNIQUE, quantidade.

### 2.5 Lotes e Estoque (núcleo)
- `batches`: product_id + batch_number UNIQUE(tenant, product, number), manufactured_at, expires_at, supplier, entry_document.
- `stock_movements` (**livro razão, nunca apagado**): type enum `ENTRADA_COMPRA, ENTRADA_DEVOLUCAO, ENTRADA_AJUSTE, SAIDA_VENDA, SAIDA_DEVOLUCAO_FORNECEDOR, SAIDA_PERDA, SAIDA_QUEBRA, SAIDA_VENCIMENTO, SAIDA_AJUSTE, TRANSFERENCIA_SAIDA, TRANSFERENCIA_ENTRADA`; product, warehouse, to_warehouse, batch, quantity>0, unit_cost, total_cost, reference_type/reference_id, transfer_id, user_id, occurred_at, reason, notes, document_url. Índices: (tenant, product, occurred_at), (tenant, warehouse, occurred_at), (tenant, reference).
- `stock_balances` (cache derivado, PK produto+depósito): quantity, reserved; CHECK(reserved BETWEEN 0 AND quantity); reconstruível do livro.
- `batch_balances` (PK lote+depósito).
- `stock_reservations`: status `ACTIVE|RELEASED|CONSUMED|EXPIRED`, expires_at.
- `transfers`: saída + entrada ligadas ao mesmo transfer_id.
- `inventories` + `inventory_items` (system_qty, counted_qty, difference) → gera ajuste.

### 2.6 Compras/Entradas (v1: nota de entrada simples)
- `purchase_entries`: number sequencial, supplier, warehouse, document_number, status `OPEN|CONFIRMED|CANCELLED`; confirmar → movimentações (+lotes) + parcelas a pagar.
- `purchase_entry_items`: product, batch_number, expires_at, quantity, unit_cost.

### 2.7 Vendas
- `sales_orders`: number sequencial, customer, warehouse, seller, status `DRAFT → CONFIRMED → BILLED → (CANCELLED|RETURNED)`, subtotal, descontos item/pedido, total. **BILLED é imutável.**
- `sales_order_items`: product, batch, quantity, unit_price, discounts, returned_quantity.
- `sales_returns` + items: devolução = entrada de estoque + ajuste financeiro.

### 2.8 Financeiro
- `financial_accounts` (unificado): direction `PAYABLE|RECEIVABLE`, source (`SALE|PURCHASE|RETURN|MANUAL`), due_date, installment (n/N), amount, paid_amount (CHECK ≤ amount), status `OPEN|OVERDUE|PAID|PARTIAL|CANCELLED`.
- `financial_payments` (baixas): amount>0, interest, discount, payment_method, received_by.
- `counters` (tenant_id, key) PK — numeração sequencial com row lock.

### 2.9 Auditoria
- `audit_logs`: append-only (RLS: só INSERT), user, action, module, entity, ip, user_agent, result, before/after jsonb. Índices (tenant, created_at DESC), (tenant, action).

---

## 3. Estratégia multi-tenant
Shared database + shared schema + `tenant_id` não nulo. Resolução única do tenant na sessão (Better Auth organization ativa → middleware → `withTenant()`). Defesa em profundidade: (a) validação no servidor, (b) `tenant_id` no WHERE de toda query, (c) RLS no banco, (d) FKs compostas. v1: seleção de empresa após login; subdomínio preparado para o futuro.

## 4. Estratégia RLS
```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
- Fail-closed: sem `SET LOCAL` → 0 linhas.
- `withTenant()` sempre dentro de `db.transaction` (`SET LOCAL` só vale na transação).
- **Proibido** `SET` de sessão (vazaria contexto entre conexões do pool serverless).
- Tabelas de auth sem RLS (fluxo de login), membership validado na aplicação.
- Role `migrator` (migrations/suporte) enxerga tudo; nunca usada pela aplicação.
- Teste obrigatório: Empresa A lendo/editando dados de Empresa B → 0 linhas / erro.

## 5. Autenticação
Better Auth: email/senha, sessão em banco (revogável), 2FA obrigatório para ADMIN, convites por e-mail. Cookie `httpOnly` + `SameSite=Lax`. `middleware.ts` protege `/(app)/*`. Rate limit no login.

## 6. RBAC
Catálogo fixo de permissões → papéis-sistema seed por empresa → `requirePermission()` no início de **toda** Server Action/rota (botão some E API recusa). Limite de desconto validado no servidor via `tenant_settings`. Tabelas prontas para papéis personalizados.

## 7. Estrutura de pastas
```
src/
├── app/
│   ├── (auth)/login/
│   ├── (app)/dashboard | estoque | vendas | financeiro | relatorios | admin
│   └── api/  (auth Better Auth, exports CSV, cron)
├── server/
│   ├── db/schema/ (1 arquivo por domínio) · db/client.ts
│   ├── auth/ · tenant/with-tenant.ts ⭐ · rbac/
│   ├── modules/estoque|vendas|financeiro|compras/
│   └── audit/log.ts
├── actions/            # Server Actions por módulo
├── components/ (ui/, layout/, estoque/, vendas/, financeiro/)
├── lib/ (money.ts ⭐ centavos, csv.ts, validators zod)
└── types/
drizzle/ (migrations SQL) · scripts/seed.ts · tests/ (unit/, integration/) · docs/
```

## 8. Estoque (regras)
| Regra | Implementação | Teste |
|---|---|---|
| Saldo = soma de movimentações | `applyMovement()` grava livro + atualiza cache na mesma transação; sem endpoint de editar saldo | entrada 10, saída 3 → 7 |
| Sem exclusão | correção = estorno/ajuste (novo movimento) | DELETE recusado |
| Custo médio móvel | recálculo a cada entrada; opção FIFO por tenant | 10@10 + 10@12 → 11 |
| FEFO | sugestão ORDER BY expires_at quando `controle_fefo` | lote mais próximo primeiro |
| Reserva | CONFIRMADO reserva (disponível = fisico − reservado); FATURADO consome; CANCELADO/EXPIRADO libera | 100/20 → 80 |
| Depósitos | saldo por produto+depósito; transferência = 2 movimentos, mesmo transfer_id | soma global inalterada |
| Inventário | contagem → diferença → movimento de ajuste | contagem 8 vs sistema 10 → ajuste 2 |
| Lote/validade | exigido só com flag da empresa; bloqueio de vencido configurável; rastreabilidade lote→vendas→clientes | venda vencida bloqueada |

## 9. Vendas (fluxo)
`DRAFT → CONFIRMADO (reserva) → FATURADO (baixa + movimento + parcelas) → [devolução]`; cancelamento libera reserva. Pós-FATURADO imutável — correção só por devolução/estorno. Descontos limitados por papel (validados no servidor). Kits baixam componentes. Numeração sequencial por tenant.

## 10. Financeiro
Geração de parcelas a partir de venda faturada (a receber) e entrada de compra confirmada (a pagar). Baixa registra `financial_payments` (juros/desconto); `paid_amount` nunca > `amount`. Fluxo de caixa = realizado (baixas) + previsto (contas em aberto por vencimento). Inadimplência = a receber vencida não paga. Nenhum valor calculado "só na tela".

## 11. Auditoria
Helper `audit()` em toda mutação sensível (LOGIN, CRIACAO/ALTERACAO_PRODUTO, ENTRADA/SAIDA_ESTOQUE, TRANSFERENCIA, CRIACAO/CANCELAMENTO_VENDA, PAGAMENTO, RECEBIMENTO, ALTERACAO_PERMISSAO, ALTERACAO_CONFIGURACAO). Tabela append-only, sem API de exclusão.

## 12. Testes
- **Unitário (Jest):** saldo, reserva, custo médio, FEFO, limite de desconto, status financeiro, baixa > saldo = erro.
- **Integração (Jest + Postgres real):** RLS (A≠B), venda baixa estoque, cancelar libera reserva, venda gera a receber, compra gera a pagar, vendedor ≠ admin, lote vencido bloqueado.
- Banco de teste isolado (`DATABASE_URL` de teste) — nunca o dev.

## 13. Deploy (Vercel)
| Ambiente | Banco |
|---|---|
| development | Postgres Docker local (ou branch Neon) |
| preview | Branch Neon automática por PR |
| production | Neon main |

Migrations geradas (`drizzle-kit generate`) e aplicadas por GitHub Action no merge — nunca automático no boot. `.env` nunca versionado. Cron Vercel: expiração de reservas, OVERDUE, alertas de validade/estoque mínimo.

## 14. Decisões aprovadas
1. ORM: **Drizzle** · 2. Auth: **Better Auth** · 3. Banco: **Neon** · 4. Compras: **nota de entrada simples na v1** · 5. Empresa: **seleção pós-login (subdomínio futuro)** · 6. Testes: **Jest** ·
Padrões: BRL único; kits baixam componentes; margem = % sobre custo; sem Redis na v1; arquivos em Vercel Blob; sem cálculo fiscal na v1; e-mails via Resend; Sentry na v1; expiração de reserva híbrida; alertas por painel na v1; export CSV na v1; numeração `VENDA-000123`; LGPD sem apagar histórico; unidades globais.
Frontend: **tema dark por padrão** (`<html class="dark">` + toggle claro/escuro persistido em `lg-theme`; remap das utilidades Tailwind no bloco `.dark` de `globals.css` — novas telas usam as mesmas classes, nunca `dark:` espalhado); **cupom térmico não fiscal (80mm) na venda faturada — NFC-e é fase futura**; leitor de código de barras USB no fluxo de vendas (câmera/QR fica para depois).

---

## Fases (ordem de execução aprovada)
1 ✅ Arquitetura → 2 Banco → 3 Auth → 4 Empresas/tenants → 5 Usuários/Permissões → 6 Estoque → 7 Produtos → 8 Lotes/validade → 9 Inventário → 10 Vendas → 11 Financeiro → 12 Relatórios → 13 Dashboard → 14 Auditoria → 15 Segurança/Testes → 16 Deploy.
