# Regras de Testes (Jest + Testing Library + Postgres real)

Aplica para: `tests/**`

## Organização
- `tests/unit/` → regras de negócio puras (cálculos, estados, permissões) — sem banco.
- `tests/integration/` → com Postgres real (`DATABASE_URL` de teste): RLS, movimentações, financeiro.
- Nome: `{modulo}.{unit|integration}.test.ts` (ex.: `stock-balance.unit.test.ts`, `rls.integration.test.ts`).

## Estrutura
- `describe` + `it` — nunca `test()` no nível superior.
- `describe("applyMovement")` / `it("entrada 10 + saída 3 = saldo 7")`.

## Integração / RLS
- Usar banco de teste isolado (Docker ou branch Neon) — **nunca** o banco de desenvolvimento.
- Setup cria tenant A e tenant B com dados equivalentes; cada teste declara em qual tenant roda (`withTenant`).
- Cobertura obrigatória de isolamento:
  1. Sob tenant A: `SELECT` de registro de B → 0 linhas
  2. Sob tenant A: `UPDATE` de registro de B → 0 linhas afetadas
  3. `INSERT` com `tenant_id` de B → erro de policy
- Nunca mockar o banco nos testes de RLS — mock destrói o que se quer testar.

## Cobertura mínima por módulo
- Estoque: saldo, reserva, custo médio, FEFO, estorno.
- Vendas: transições de status, limite de desconto por papel, imutabilidade pós-BILLED.
- Financeiro: geração de parcelas, baixa parcial, `paid_amount > amount` = erro.
- RBAC: Visualizador/Vendedor recebem 403 em ação proibida; ADMIN 200.

## Cleanup
- `afterEach`/`afterAll` limpam registros criados (soft delete ou truncate de teste).
- Nunca assumir banco vazio; dados de seed tratados explicitamente.
