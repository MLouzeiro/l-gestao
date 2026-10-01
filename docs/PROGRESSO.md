# L Gestão — Progresso (sessão de trabalho)

> Atualizado em: 01/10/2026. Estado salvo para retomar a sessão seguinte.

**Nome do sistema: L Gestão** (slug `l-gestao`, URL `l-gestao.vercel.app`;
conceito: L de Louzeiro + gestão — estoque · vendas · financeiro).

## Sessão 01/10/2026 — Neon + Vercel no ar, Git e FIX do bypass RLS

### Infra concluída
- Projeto Neon `tiny-dew-43682715` (branch `br-round-cake-b6kdoftb`, PG 17):
  migrations aplicadas; papel `estoque_app` criado.
- Vercel linkada ao GitHub (`l-gestao.vercel.app`), env vars Production
  (`DATABASE_URL`, `AUTH_SECRET`, `BETTER_AUTH_URL`) — deploy + login E2E
  validados (Playwright, incl. 2FA).
- GitHub: remote `origin` → `MLouzeiro/l-gestao`, branch `main`, HEAD `7661351`.
- `.github/workflows/migrations.yml` criada (ARQUITETURA §13): push em `main`
  com paths `drizzle/**` + `workflow_dispatch`; roda typecheck/test →
  `db:migrate`. **PENDENTE**: secret `DATABASE_URL_ADMIN` (URL de conexão do
  papel `neondb_owner` no Neon) precisa ser adicionado manualmente no GitHub
  (Settings → Secrets and variables → Actions) — CLI `gh` não instalado.

### 🔴 Fix de segurança aplicado — BYPASSRLS do `estoque_app`
- **Problema**: `estoque_app` (papel da app em produção) tinha atributos
  próprios `BYPASSRLS`/`CREATEROLE`/`CREATEDB`/`REPLICATION` → qualquer
  conexão sem `SET app.current_tenant_id` lia TODAS as linhas (burlava a RLS).
- **Bloqueio**: `ALTER ROLE` só é permitido a quem tem ADMIN OPTION no papel;
  só o superuser `cloud_admin` (inacessível) tinha. A API Neon não expõe
  alteração de atributos de papel.
- **Solução aprovada e aplicada**: excluído o papel pela API Neon e recriado
  por SQL como `neondb_owner` com o **mesmo nome e senha** → Vercel mantém a
  mesma `DATABASE_URL` (zero mudança de env). Grants da migration `0005`
  reaplicados (156 grants em tabelas de `public`).
- **Estado novo**: `rolbypassrls`/`rolcreaterole`/`rolcreatedb`/
  `rolreplication` = `false`; papel sem memberships (fora de `neon_superuser`);
  `neondb_owner` é membro com ADMIN OPTION (administra o papel no futuro).
- **Verificação**:
  - node/pg como `estoque_app` **sem** tenant → 0 linhas (antes: 7);
  - com tenant Empresa Demo → 4 linhas ✅;
  - produção Playwright: login/2FA → painel → `/estoque/produtos` →
    "4 de 4" produtos, **0 erros de console** ✅.

### Correção de código
- `scripts/seed.ts` (~linha 173): UPDATE de `tenant_settings` movido para
  dentro de `withTenant()` — único acesso a dados fora do helper no audit
  completo feito hoje (demais usos corretos).

### Validação (01/10/2026)
- `npm run typecheck` ✅ · `npm test` → 7 suítes / **124** testes ✅
- Sem mudança de código de aplicação nesta etapa além do `seed.ts`.

### ▶ PRÓXIMO PASSO (retomar aqui)
1. Usuário adiciona o secret `DATABASE_URL_ADMIN` no GitHub; o primeiro push
   que alterar `drizzle/**` dispara a Action de migrations.
2. Commit/push das mudanças pendentes (`.gitignore`, `scripts/seed.ts`,
   `.github/`, `docs/PROGRESSO.md`) — **aguardando confirmação do usuário**.
3. ~~`npm run backup`~~ — **CONCLUÍDO** (01/10/2026, robocopy 0 falhas).
4. Depois: melhorias da auditoria (security headers, rate limit, cron de
   reservas, Sentry, docs README/DATABASE/SECURITY, dark mode) e
   **Fase 11 — Financeiro (M4)**.

## Sessão 30/09/2026 (noite) — Auditoria, nome e Git

### Auditoria inicial do projeto (read-only, entregue)
- Relatório com 20 seções + classificação 🔴🟠🟡🔵🟢.
- Achados principais: 🔴 **sem Git/CI/deploy/Neon ativo** (tudo em dev local +
  backup Drive); 🟠 audit trail ausente (Fase 14), signup aberto sem rate
  limit, cron de liberação de reservas inexistente, Sentry ausente;
  🟡 sem dark mode, sem README/DATABASE/SECURITY, sem security headers,
  sem testes de componente/E2E, 4 vulnerabilidades moderadas só em devDep.
- Confirmações do usuário: projeto é **novo do zero** (não está em produção);
  aprovou executar os passos 2–3 do plano; cadastro de usuário: **aberto E por
  convite** (os dois).

### Correções aplicadas (aprovadas, pós-auditoria)
1. `src/actions/equipe.ts` — `console.log` do link de convite agora só roda
   **fora de produção** (em produção vazaría o token do convite nos logs).
2. `.gitignore` — cobre `*.log` e `.tmp-dev.log`.
3. Removido `jest.integration.config.ts` (arquivo morto; o script usa
   `jest.config.integration.ts`).

### Nome do sistema — DECIDIDO
- **L Gestão** · slug `l-gestao` · `l-gestao.vercel.app` **livre** (checado
  via HTTP 404 DEPLOYMENT_NOT_FOUND; DNS wildcard da Vercel não serve).
- Critérios da entrevista: pt-BR, abrangente, ≤8 letras, sem "estoque",
  falável; L = **L**ouzeiro + **gestão**. Descartados por ocupados:
  lgestao, lagestao, gestao, negocia, varejo, caixa etc.
- Aplicado em: `package.json` (name `l-gestao`), `src/app/layout.tsx`
  (title), tela de login, sidebar (logo "L"), este documento.

### Decisões de infra
- Banco de produção: **Neon** (plano aprovado — branching grátis por PR).
  Usuário tem conta Supabase também, mas branching é pago lá → descartado.
- Identidade Git (repo local): `Louzeiro <marcio.louzeiro05@gmail.com>`.
- GitHub do usuário: `Mlouzeiro` (`gh` CLI não instalado).

### Git — iniciado
- `git init` + primeiro commit **`61a234e`** (176 arquivos; verificado que
  `.env`, `.tmp-dev.log`, rag.db, node_modules e .next **não** entram).
- Validação antes do commit: typecheck ✅ · 124 unit ✅ · build ✅.
- Backup `npm run backup` OK (30/09 23:31).

### ▶ PRÓXIMO PASSO (retomar aqui)
1. ~~Usuário cria repo privado `l-gestao` no GitHub~~ — **CONCLUÍDO**:
   `https://github.com/MLouzeiro/l-gestao.git` · remote `origin` · branch
   `main` (renomeada de `master`) · push OK = `8402c40`.
2. Em seguida (após autorização): projeto **Neon** novo + migration inicial,
   conectar **Vercel** (preview por PR), GitHub Action de migrations
   (ARQUITETURA §13).
3. Melhorias da auditoria pendentes: security headers, rate limit
   signup/login (signup fica ABERTO + convite), cron de expiração de
   reservas, Sentry/logger, docs README/DATABASE/SECURITY, dark mode.
4. Aí sim: Fase 11 — Financeiro (M4).

## Onde paramos

**Fase 10 — Vendas (M3) — CONCLUÍDA e verificada.**

Fases 1–10 concluídas e verificadas (auth, empresas, usuários/2FA, estoque,
produtos, lotes/FEFO, inventário, **vendas**) com testes unit + integração
passando, build OK e smoke test manual da UI.

### O que a Fase 10 entregou
- `src/server/modules/vendas/sales-rules.ts` (regras puras, TDD) +
  `tests/unit/sales-rules.test.ts`.
- `src/server/modules/vendas/sales.service.ts`: `createSale`, `updateSale`,
  `deleteSale` (só DRAFT), `confirmSale` (reserva), `cancelSale` (libera),
  `billSale` (consome reserva + `applyMovement(SAIDA_VENDA, SALE)`),
  `listSales`, `getSaleDetail`, `SaleError`.
- `src/actions/vendas.ts` — 6 Server Actions (`_salvarVenda`, `_apagarVenda`,
  `_confirmarVenda`, `_cancelarVenda`, `_faturarVenda`), retorno
  `{ ok, message, saleId? }` / `{ error }`, `requirePermission` + Zod +
  `withTenant()`.
- UI: `src/app/(app)/vendas/{page,nova/page,[id]/page,[id]/editar/page}.tsx`
  + `src/components/vendas/{status-badge,venda-form,venda-acoes}.tsx` +
  `src/server/modules/vendas/form-data.ts`; Sidebar mostra **Vendas** só com
  `sales.view` (`src/components/layout/sidebar.tsx` recebe `permissions`).
- RBAC: `PermissionError`/`assertPermission` movidos para
  `src/server/rbac/permissions.ts` (módulo puro — o Jest de integração não
  pode importar better-auth/ESM); `require-permission.ts` importa de lá.

### Verificação (30/09/2026) — tudo passou
- `npm run typecheck` ✅
- `npm test` → 7 suítes / **124** testes ✅
- `npm run test:integration` → 5 suítes / **50** testes ✅ (Docker)
- `npm run build` ✅ (rotas `/vendas`, `/vendas/nova`, `/vendas/[id]`,
  `/vendas/[id]/editar`)
- Smoke test manual (Playwright + dev server porta 3001):
  login → Empresa Demo → criar venda (prévia R$ 37,80) → detalhe
  `VENDA-000001` → Confirmar (reserva) → Faturar (baixa −2, saldo 46) →
  estoque mostra movimento "Venda" → filtros da lista → editar bloqueado
  pós-BILLED → busca `VENDA-000001` acha a venda.

### Bugs encontrados no smoke test (corrigidos)
1. `VendaAcoes` não enviava `saleId` (form sem input escondido) → Zod devolvia
   "Invalid input: expected string, received null". Corrigido com
   `<input type="hidden" name="saleId">` + `parseSaleId()` defensivo em
   `src/actions/vendas.ts` (mensagem pt-BR "Venda inválida.").
2. Busca da lista não achava `VENDA-000001` (coluna `number` guarda o inteiro
   `1`). `listSales` agora compara o **número formatado**
   (`concat(prefixo, '-', lpad(n, 6, '0')) ILIKE`) — prefixo/largura exportados
   como `SALE_NUMBER_PREFIX`/`SALE_NUMBER_WIDTH` em `sales-rules.ts`;
   teste de regressão em `tests/integration/sale.test.ts`.

### Pendências conhecidas (não bloqueiam a Fase 11)
- **Kit explosion**: faturar produto kit não baixa componentes
  (`productComponents`) — decidir se entra no M3 ou depois.
- **Expiração de reservas**: `expiresAt` é gravado, mas não existe cron que
  libere reservas `ACTIVE` vencidas (`expira_reserva_horas`).
- **Devolução** (`RETURNED` / `sales_returns`) — etapa posterior (pós-Fase 10).
- Dados de teste no banco local: tenant acidental `Farmacia`
  (`farmacia-xa7a`, criado durante navegação do smoke test) e venda
  `VENDA-000001` faturada em `empresa-demo` — apagar só se o usuário pedir.

### Próximos passos (ordem)
1. **Fase 11 — Financeiro (M4)**: parcelas no faturamento (a receber) e na
   entrada de compra (a pagar), `financial_payments` (baixa parcial),
   status recalculado + `OVERDUE` por cron.
2. Depois: Fase 12 Relatórios → 13 Dashboard → 14 Auditoria → 15 Segurança →
   16 Deploy.
3. Ao final de cada marco: `npm run backup`.

### Arquivos de referência para retomar
- Regras de venda: `src/server/modules/vendas/{sales-rules,sales.service}.ts`
- Padrão de action: `src/actions/vendas.ts` / `src/actions/estoque.ts`
- Testes: `tests/integration/sale.test.ts` (50 testes de vendas nas 5 suítes
  de integração), `tests/unit/sales-rules.test.ts`
- Permissões: `src/server/rbac/permissions.ts`
  (`sales.view/manage/discount/billing`), `PermissionError` (403)
- Limites: `tenant_settings.max_desconto_vendedor/max_desconto_gerente`
  (`numeric(5,2)`), `reserva_estoque`, `expira_reserva_horas`
- Tabela de numeração: `counters` (`src/server/db/schema/financeiro.ts:134`)
- Fronteiras do escopo: não existe ainda `src/server/audit/` (Fase 14),
  devoluções, financeiro.
