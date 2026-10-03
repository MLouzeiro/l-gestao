# L Gestão — Progresso (sessão de trabalho)

> Atualizado em: 03/10/2026. Estado salvo para retomar a sessão seguinte.

**Nome do sistema: L Gestão** (slug `l-gestao`, URL `l-gestao.vercel.app`).

## Sessão 03/10/2026 — PROMPT MESTRE aplicado: diagnóstico + Sprint 1 (E2 Núcleo SaaS)

### PROMPT MESTRE — diagnóstico aprovado (§50/§51)
- Diagnóstico completo entregue (arquitetura, banco 40 tabelas vs requisitos,
  gaps, impactos) com decisões do usuário: **E2 Núcleo SaaS primeiro** ·
  **postos = warehouses estendidas** · **workflow de transferência ao lado do
  fluxo simples** · **escopo = núcleo + laboratório** (alimentação fica p/ depois).
- Sequência: E2 Núcleo SaaS → E3 Unidades → E4 Movimentações → E5 Lotes/
  validade+rastreio → E6 Transferências workflow → E7 Matriz→Postos →
  E8 Reposição → E9 Auditoria global+Central → E10 Alertas → E11-12
  Indicadores → E13 Relatórios → E14-16 Testes/Segurança/Docs.
- Pré-condição resolvida: WIP da sessão de auditoria consertado no mínimo
  (`equipe.ts`: `aceite` fora de escopo; overload do `withTenant` não aceitava
  `userId` undefined) — typecheck 100% verde, intenção dela preservada.

### Sprint 1 — E2 Núcleo SaaS CONCLUÍDO
- **Migration `0008_modules_billing.sql`**: `modules` (catálogo global 13
  módulos), `plan_modules`, `tenant_modules` (RLS), `subscriptions` (RLS,
  TRIAL no provisionamento), `tenant_contract_versions` (RLS); enum
  `subscription_status`; `tenant_segment` + LANCHONETE/FRIGORIFICO; backfill
  (empresas existentes ganham todos os módulos + assinatura ACTIVE — nada
  quebra, §2). Grants padrão 0005 + journal manual.
- **Backend**: `module-rules.ts` (presets por segmento, catálogo — puro),
  `module.service.ts` (`requireModule`/`hasModule`/`listTenantModuleKeys`/
  `setTenantModule` com `audit()` MODULO_ATIVADO/DESATIVADO,
  `provisionModules` idempotente); `provisionTenant` passa a provisionar
  módulos+assinatura por segmento.
- **Frontend**: menu dinâmico na sidebar (itens só de módulos contratados);
  `/admin/modulos` (catálogo + assinatura + toggle) com `_alternarModulo`
  (`settings.manage` + Zod); link em `/admin`; **gate de servidor** no PDV
  (página + `checkoutPdv`) exemplar do padrão `requireModule`.
- **Testes**: `module-rules.test.ts` (8 unit) + `modules.test.ts` (9 integração:
  preset por segmento, TRIAL, requireModule recusa, RLS de leitura E escrita,
  catálogo global). Totais: **unit 283/283 (16 suítes)** ·
  **integração 107/107 (11 suítes)** · typecheck ✅.
- **Smoke**: `/admin/modulos` lista 13 módulos + assinatura; desativar PDV →
  `/pdv` mostra "Módulo PDV não está contratado…" e **menu some "PDV"**;
  reativar → volta (200). Screenshot `admin-modulos.png`.

### ▶ PRÓXIMO PASSO
1. Commit do Sprint 1 (com autorização) + deploy (Action aplica a 0008).
2. Sprint 2 — E3 Unidades: `warehouses` + tipo (MATRIZ/FILIAL/POSTO), pai,
   responsável; estoque-alvo por unidade (min/máx/ponto de reposição);
   permissão de acesso por unidade (posto não vê outro posto).

## Sessão 02/10/2026 (noite) — Deploy produção + PDV sem barra de rolagem

### Deploy do PDV (commit `5bd8446`) — CONCLUÍDO
- Push `c1d9d5d..5bd8446` → `MLouzeiro/l-gestao`; Action **"Migrations"**
  verde (typecheck + 258 testes unit + `db:migrate`) — o secret
  `DATABASE_URL_ADMIN` **já estava configurado** (pendência do PROGRESSO
  anterior resolvida; a Action aplica migrations no push de `drizzle/**`).
- **Migration 0007 confirmada no Neon produção** (`tiny-dew-43682715`):
  `cash_registers`/`cash_movements`, `sales_orders.payment_method/origin`,
  `tenant_settings.pix_key/pix_city` — journal id 8.
- Vercel produção no ar: `/pdv` responde (307 → login, guard OK).
- Pré-validação do commit num worktree limpo antes do push (typecheck 0 erros
  + 258/258 unit) — a árvore commitada fica verde; o WIP da sessão de
  auditoria (actions/*) nunca foi ao repositório.

### PDV sem barra de rolagem (pedido do usuário, com print)
- Causa: o root usava `h-[calc(100vh-4.5rem)]`, mas o chrome real do layout é
  header `h-14` (3.5rem) + `main p-6` (3rem) = **6.5rem** → sobrava ~32px e a
  página rolava (o painel de pagamento sumia embaixo).
- `pdv-client.tsx`: root `lg:h-[calc(100dvh-6.5rem)] lg:overflow-hidden`
  (abaixo de lg vira `h-auto` com scroll natural); cards 150→132px;
  itens do carrinho `min-h-0` (scroll interno); painel de pagamento
  compacto (Recebido + Desconto em `grid-cols-2`, troco dentro do campo,
  botões/apertos menores); gaps 3→2.
- Validado: **sem scroll** em 2133x900, 1518x853, 1422x800, 2844x1600
  (`scrollHeight == clientHeight`) com Finalizar/Carrinho sempre visíveis;
  troco renderizando (R$ 31,10 no smoke). Screenshot `pdv-sem-rolagem.png`.
- 275/275 unit ✅ · typecheck sem erros nos arquivos do PDV ✅.

## Sessão 02/10/2026 (tarde) — Etapa 3: PDV + Caixa CONCLUÍDA

Pedido do usuário: "PDV igual ao do l-estoque, mas melhorado". Ordem alterada
com aprovação: PDV pulou para frente (Etapa 2 — Comercial fica para depois).
Escopo aprovado: caixa completo + atalhos F1–F9 (mapa proposto).

### Migration `0007_pdv_cash.sql` (à mão + journal manual)
- Enums `sale_payment_method` (DINHEIRO/PIX/DEBITO/CREDITO/VALE/OUTRO),
  `sale_origin` (PDV/VENDA/ONLINE/IMPORT), `cash_status`, `cash_movement_type`.
- `sales_orders` + `payment_method` (default DINHEIRO) + `origin` (VENDA).
- `tenant_settings` + `pix_key`, `pix_city` (QR PIX do balcão).
- Tabelas `cash_registers` (1 OPEN por tenant — unique parcial) e
  `cash_movements` (livro imutável: RLS só SELECT/INSERT).
- RLS ENABLE+FORCE nas 2 + grants padrão 0005. Aplicada no Docker local.

### Backend (TDD: RED → GREEN)
- `src/lib/pix.ts` — payload PIX (EMV + CRC-16/CCITT-FALSE), centavos;
  `normalizePixKey` (celular→+55, CNPJ dígitos, e-mail/aleatória passthrough).
- `src/server/modules/pdv/pdv-rules.ts` — troco, validação de pagamento
  (DINHEIRO exige recebido; CREDITO 1–12; demais à vista), esperado por forma
  (abertura + vendas + suprimentos − sangrias), limite de sangria, diferença.
- `src/server/modules/pdv/cash.service.ts` — `openCash`/`closeCash`
  (contagem por forma + diferença), `addSupply`/`addSangria` (sangria ≤ saldo),
  `getOpenCash`/`getCashSummary`.
- `src/server/modules/pdv/pdv.service.ts` — `checkoutPdv`: caixa aberto →
  `createSale` (paymentMethod+origin PDV) → `confirmSale` → `billSale` →
  à vista (`registerPayment` → conta **PAID**) → movimento VENDA no caixa →
  `audit()` — **uma transação só**. Leituras: `listPdvProducts`
  (disponível = saldo − reservado), `listPdvCustomers`, `getPdvSettings`.
- `sales.service.ts` — `SaleInput` + `paymentMethod`/`origin`; `billSale`
  retorna `accountIds` (backwards-compatible).
- `src/actions/pdv.ts` — `_checkoutPdv`/`_abrirCaixa`/`_fecharCaixa`
  (`sales.manage`) e `_suprimento`/`_sangria` (`finance.manage`) — Zod +
  `withTenant(tenantId, userId, fn)` + retorno `{ok,data}/{ok,error}`.

### Frontend
- `/pdv` (client `pdv-client.tsx`): layout do l-estoque — busca (barcode-first
  via `resolveProductByCode`, Enter) + QTD + grid | carrinho + total gigante +
  4 formas + parcelas crédito + **recebido → troco** + desconto (F4) + PIX QR
  (`react-qr-code` instalado) com modal tela cheia + cliente (F6).
- Atalhos **F1–F9** (preventDefault + refs p/ closure): F1 ajuda, F2 busca,
  F3 qtd, F4 desconto, F5 finalizar, F6 cliente, F7 pagamento, F8 cupom
  (vai p/ `/vendas/{id}`), F9 remove item selecionado.
- Modais de caixa (abrir/fechar/suprimento/sangria) com esperado/contagem;
  `<KpiStrip>` (Caixa, Vendas no caixa, Total vendido, Esperado em dinheiro).
- Sidebar: item **PDV** (gate `sales.manage`).

### Testes (todos verdes)
- Unit 15 suítes / **275** (+`pix.unit.test.ts` CRC16 vetores/payload,
  `pdv-rules.test.ts` troco/pagamento/caixa/RBAC-sangria).
- Integração 10 suítes / **98** (+`pdv.test.ts` 10 testes: à vista 10→7 com
  conta PAID + pagamento + movimento, crédito 3×, sem caixa recusa, abertura
  duplicada recusa, sangria acima do saldo recusa, fechamento diferença −500,
  **RLS** caixa A invisível p/ B, estoque insuficiente).
- **Smoke E2E (dev :3001)**: abrir caixa (fundo 50) → vender Café Torrado
  (VENDA-000005, DINHEIRO 50 → troco 31,10) → KPIs (Aberto #1, 1 venda,
  esperado 68,90) → fechar caixa contando 68,90 → **diferença R$ 0,00**.
  Banco conferido: `cash_movements` ABERTURA/VENDA/FECHAMENTO, venda BILLED
  origin PDV, conta PAID. Screenshot `pdv-fluxo-completo.png`.
- Fix UX: `catch` no submit dos modais de caixa (modal não trava mais em
  falha de rede).

### ⚠️ Bloqueio conhecido (NÃO é do PDV)
- `npm run build`/typecheck falham SOMENTE em `src/actions/equipe.ts` e
  `src/actions/vendas.ts` — **WIP da sessão paralela** (Fase 14 auditoria,
  em andamento: criou `src/server/audit/` + `src/server/modules/auditoria/`
  e está adaptando as actions ao `withTenant(tenantId, userId, fn)`).
- PDV usa/estende `sales.service.ts` (arquivo compartilhado com a auditoria):
  commit do PDV precisa levar junto `src/server/audit/` +
  `src/server/modules/auditoria/` (senão o import do audit quebra).
- Dev DB: 2FA do `teste@empresa.com.br` reconfigurado (segredo novo) para o
  smoke; códigos de recuperação gerados — apenas ambiente local.

### ▶ PRÓXIMO PASSO
1. Commit do PDV (com autorização) — ver bloqueio acima.
2. Etapa 2 — Comercial (planos, módulos, contratos, landing, admin) quando
   a sessão de auditoria terminar; depois Alimentação e Hardening.

## Sessão 02/10/2026 — Auditoria da plataforma + Etapa 1 fechada

### Auditoria mestre entregue (read-only, 30 seções)
- Inspecionado sem alterar produção: arquitetura, banco (39 tabelas/6
  migrations/RLS 28 tabelas), multi-tenant, módulos, segurança, testes, deploy.
- **Plano aprovado (ordem)**: 1️⃣ Fechar Financeiro → 2️⃣ Comercial (planos,
  módulos, contratos, landing, admin da plataforma) → 3️⃣ PDV+caixa →
  4️⃣ Alimentação (mesas/cozinha/cardápio/delivery) → 5️⃣ Hardening.
- Decisões: **camada de indicadores (KPIs) em todas as telas**; assinatura sem
  gateway na v1; **sem emissão fiscal** (NFC-e fora da v1); auditoria+plano
  registrados neste PROGRESSO.md.

### Commit do usuário (não foi eu — 02/10 08:27)
- `9cab895` — Fase 11 completa: UI `/financeiro` (lista+detalhe+baixa),
  módulo de compras (CRUD + parcelas a pagar), cron `/api/cron/overdue`,
  `vercel.json` com cron diário, `sale_payments`/`installments` (0006).

### Alterações desta sessão (aguardando autorização para commit)
- `sales.service.ts`: `expireReservations()` — reservas ATIVAS vencidas viram
  EXPIRED e devolvem `stock_balances.reserved` (mesma transação); a venda
  continua CONFIRMED; `settleReservations` aceita `"EXPIRED"`.
- **Cron novo** `/api/cron/reservations` + entrada no `vercel.json`
  (`0 4 * * *`, diário — compatível com plano Hobby; subir para horário no Pro).
- `financial.service.ts`: `getFinancialSummary()` — agregados do painel
  financeiro (aberto, vencido, 7 dias, recebido/pago no mês, contagens).
- `components/metrics/kpi-strip.tsx` — componente `<KpiStrip>` reutilizável
  (fundação da camada de indicadores das demais telas, Etapa 2).
- `/financeiro`: 8 KPIs no topo (abaixo do título, acima das abas).
- `.env.example`: comentário dos crons atualizado (overdue + reservations).

### Validação (02/10/2026) — tudo passou
- `npm run typecheck` ✅ · `npm test` → 10 suítes / **174** unit ✅ ·
  `npm run test:integration` → 7 suítes / **70** testes ✅ (Docker) ·
  `npm run build` ✅ (rota `/api/cron/reservations` no output).
- Smoke (dev :3001): `/financeiro` renderiza os 8 KPIs; crons respondem
  `{"ok":true,...}`; 0 erros de console (só favicon 404).
- Testes novos em `tests/integration/sale.test.ts`: expiração libera só a
  reserva vencida (30→20, EXPIRED/ACTIVE, idempotente) e **RLS**: cron na
  Empresa A não enxerga reservas da Empresa B.

### ▶ PRÓXIMO PASSO (retomar aqui)
1. **Etapa 2 — Comercial**: migration 0007 (catálogo `modules`,
   `tenant_modules`, `plan_modules`, enum de segmento expandido c/
   LANCHONETE/RESTAURANTE/SUPERMERCADO, flags de produto `sale_enabled/
   pdv_enabled/online_enabled/delivery_enabled` default true, `subscriptions`,
   `tenant_contract_versions`), `requireModule()`, preset de módulos por
   segmento, `<KpiStrip>` no `/painel` e nas telas existentes, longpage +
   contratação + admin `/plataforma`.
2. Depois: Etapa 3 PDV → 4 Alimentação → 5 Hardening.

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

---

## Sessão 01/10/2026 (parte 2) — Código de barras, cupom térmico e dark mode

### Código de barras USB (leitor HID) em Vendas
- `src/lib/sale-scan.ts` — `resolveProductByCode()`: resolve produto por
  barcode (prioridade) ou SKU; TDD em `tests/unit/sale-scan.test.ts` (7 testes).
- `venda-form.tsx`: campo `#scan-codigo-barras` (autoFocus; Enter adiciona o
  item — incrementa a qtd se já estiver no carrinho); mensagem de erro em
  pt-BR para código desconhecido; `SaleFormProduct` agora inclui `barcode`
  (`form-data.ts`).
- E2E Playwright validado (add/incrementa/SKU/desconhecido/espaços, foco
  retido, 0 erros de console). Câmera/QR (`html5-qrcode`) = futuro.

### Cupom térmico não fiscal (80mm)
- `src/components/vendas/cupom.tsx` — `CupomNaoFiscal` + botão "Imprimir
  cupom (80mm)" (`window.print()`), exibido **somente** em venda `BILLED`
  (`vendas/[id]/page.tsx` busca também `tenants` para razão social/CNPJ).
- Print CSS em `globals.css` (`.cupom-impressao` off-screen; `@media print`
  esconde a app inteira; `@page { size: 80mm auto; margin: 0 }`) — validado
  com `emulateMedia('print')`, inclusive no tema dark.
- **NFC-e é fase futura** (fora da v1): o cupom atual é não-fiscal, sem
  assinatura/chave/SEFAZ.

### Tema visual — dark por padrão (referência: app antigo `l-estoque`)
- Padrão: `<html class="dark">` (estático) + script anti-flash lê
  `lg-theme` (localStorage); `ThemeToggle` (`components/layout/theme-toggle.tsx`)
  no header alterna e persiste; sem preferência salva = **dark**.
- **Remap em `globals.css`**: bloco `.dark` **fora de @layer** re-mapeia as
  utilidades usadas pelo app (`bg-white`, `slate-*`, chips tintados,
  foco/hover). **Regra para novas telas**: usar as mesmas classes
  (`bg-white`, `text-slate-800`, `border-slate-300`, `hover:bg-slate-50`,
  `focus:ring-indigo-100`…) — o remap cuida do dark. Se um hover/focus novo
  não estiver mapeado, adicionar a regra equivalente em `globals.css`
  (ex.: `.dark .hover\:text-indigo-700:hover`) — nunca espalhar `dark:`
  por componentes (a base `.dark` unlayered vence os utilitários do
  Tailwind; por isso foco/hover precisam de regra explícita).
- Efeitos: wrapper com glows radiais; sidebar `.sidebar-rail` /
  `.brand-mark` / `.brand-title` / nav `.nav-active`; header `.app-header`
  (translúcido + blur); sombra de profundidade só em superfícies
  (`bg-white` sem `input/select/textarea/button`); glow no hover de
  `bg-indigo-600`; inputs com borda + anel indigo no foco
  (`.dark input:focus` vence `focus:border/ring` do Tailwind).
- Referências reaproveitadas do projeto antigo `l-estoque`
  (`C:\Users\Louzeiro\Documents\Louzeiro\Projeto\l-estoque`): fluxo PDV
  (busca + Enter), tema dark como padrão, `QRScannerModal` (câmera — futuro),
  etiquetas de lote (futuro).
- Validação E2E: painel/estoque/vendas/detalhe/empresas/login em dark,
  toggle claro⇄escuro (persistência), foco/hover computados, print do cupom,
  0 erros de console; `typecheck` ✅ · **131 testes** ✅.

---

## Sessão 02/10/2026 — Fase 11: Financeiro (M4) CONCLUÍDA

**Fase 11 — CONCLUÍDA e verificada** (escopo aprovado "tudo de uma vez":
receber + compras + cron + campo de parcelas na venda). Fases 1–11 prontas.

### O que a Fase 11 entregou
- **F11.1** Migration `drizzle/0006_deep_wind_dancer.sql`: coluna
  `installments` em `sales_orders` e `purchase_entries` (1–12; Zod +
  `assertInstallments` + select no form de venda).
- **F11.2–F11.4 (núcleo)** `src/server/modules/financeiro/`:
  - `financial-rules.ts` — status (`OPEN > PARCIAL` … prioridade
    `CANCELLED > PAID > OVERDUE > PARTIAL > OPEN`), `dueDateFor`,
    `splitInstallments` (soma bate no total), datas de coluna `date`
    sempre dia-UTC (`asUtcDay`); + `tests/unit/financial-rules.test.ts`
    (18 testes).
  - `financial.service.ts` — `createAccounts`/`createReceivables`/
    `createPayables`, `registerPayment` (lock `FOR UPDATE`,
    `paid_amount ≤ amount`, juros/desconto), `markAccountsOverdue`,
    `cancelAccountsForSource`, `listAccounts` (com `partyName`),
    `getAccountDetail`, `listTenantIdsForCron`.
  - `billSale` (vendas) passou a chamar `createReceivables` (descrição
    `VENDA-000001`).
- **F11.5 (UI receber/pagar)** `src/lib/dates.ts` (`formatDateOnly` UTC,
  `formatDateTime`, `todayInputValue`, `dateOnlyInput`),
  `src/actions/financeiro.ts` (`_registrarBaixa`, Zod, `FinancialError`
  → `{ error }` pt-BR), `src/components/financeiro/{status-badge,
  baixa-form}.tsx`, páginas `/financeiro` (abas receber/pagar, filtros,
  badges, paginação) e `/financeiro/[id]` (baixa parcial → erro →
  quitação); sidebar do Financeiro liberado com `finance.view`.
- **F11.6 (módulo Compras)** TDD:
  - `purchase-rules.ts` + `tests/unit/purchase-rules.test.ts` (**25
    testes**): `assertPurchaseTransition`, validação de itens (500 máx,
    produto+lote duplicado, validade), `calcPurchaseTotalCents`,
    `formatPurchaseNumber` (`COMPRA-000001`).
  - `purchase.service.ts`: `createPurchase`/`updatePurchase`/
    `deletePurchase` (só OPEN), `confirmPurchase` (applyMovement
    `ENTRADA_COMPRA` + `createPayables` na mesma transação),
    `cancelPurchase`, `listPurchases` (busca por número formatado OU
    fornecedor + `itemCount`), `getPurchaseDetail`, `PurchaseError`.
  - `form-data.ts` (`loadPurchaseFormData`), `src/actions/compras.ts`
    (4 actions, `purchases.manage`), UI `/compras` (+ `/nova`, `/[id]`,
    `/[id]/editar`) e `src/components/compras/{status-badge,
    compra-form,compra-acoes}.tsx`; item "Compras" na sidebar
    (`purchases.view`).
  - `tests/integration/purchase.test.ts` (**9 testes**): estoque+payable
    na confirmação, 3 parcelas somam o total, lote obrigatório, imutável
    pós-CONFIRMED, cancel, entrada manual sem payable, RLS A≠B, RBAC.
- **F11.7 (cron OVERDUE)** `src/app/api/cron/overdue/route.ts` (Bearer
  `CRON_SECRET`; sem segredo só fora de produção; listagem de tenants é
  cross-tenant de propósito — `tenants` sem RLS — e cada update roda em
  `withTenant`) + `vercel.json` (`0 3 * * *` = 00h BRT) + `CRON_SECRET`
  documentado em `.env.example`.
- **F11.8** `typecheck` ✅ · `npm run test:all` → **174 unit** (10 suítes)
  + **68 integração** (7 suítes) ✅ · `build` ✅ (rotas `/compras*`,
  `/api/cron/overdue`).
- **F11.9** Docs (este arquivo + ARQUITETURA §10), painel (módulos
  Compras/Financeiro "Concluído", roadmap Fase 11 ✓).

### Bugs corrigidos no caminho (Fase 11)
1. `movement.service.ts` — `totalCents` com `/1000` errado → o livro
   gravava total ~1000x menor (10@R$10 → R$0,01). Corrigido; regressão
   em `purchase.test.ts` (`totalCost` = "100.00").
2. `estoque/page.tsx` — `formatBRL(Number(m.unitCost))` tratava reais
   como centavos (R$12,50 aparecia R$0,13). Corrigido para
   `formatBRL(toCents(m.unitCost))`.

### Validação E2E (Playwright, dev :3001)
- Fornecedor criado em `/estoque/produtos` → `/compras/nova` (prévia
  R$ 125,00 · 3x) → `COMPRA-000001` → **Confirmar** → estoque
  **+10 @ R$12,50** (saldo 50, movimento "Compra") → Financeiro a pagar:
  3 parcelas **02/10, 02/11, 02/12** (41,66/41,67/41,67 = R$125) →
  **baixa total → Quitada**.
- Editar nota OPEN (prefill qty/custo/data) → total recalculado
  (R$30,00) → **Cancelar** → badge "Cancelada"; lista com badges/filtros.
- Cron: `GET /api/cron/overdue` → 200 `{"ok":true,"tenants":5,"updated":0}`
  (vence hoje não é vencida).

### Decisões de modelo (não reabrir)
- Compra: `OPEN → CONFIRMED` e `OPEN → CANCELLED` apenas; CONFIRMED é
  final na v1 (cancelar pós-confirmação = estorno, v2).
- Estoque "Entrada — Compra" (movimentação manual) **não** gera conta a
  pagar — só `purchase_entries` CONFIRMED gera payable (documentado em
  ARQUITETURA §10).
- Juros/desconto da baixa: informativos na v1 (o valor pago manda).
- OVERDUE vence PARTIAL (badge "Vencida" mesmo com baixa parcial).
- Datas de coluna `date`: leitura sempre por getters UTC
  (`formatDateOnly`/`dateOnlyInput`), escrita `Date.UTC` local-day.

### Dados de teste no dev (Empresa Demo)
- Fornecedor "Fornecedor Demo LTDA"; `COMPRA-000001` (CONFIRMED, 3
  parcelas, 1 quitada); `COMPRA-000002` (CANCELLED) — apagar só se o
  usuário pedir.

### ▶ PRÓXIMO PASSO (retomar aqui)
1. **Commit/push da Fase 11 — feito** (`9cab895` em `origin/main`).
2. Depois: **Fase 12 — Relatórios (M5)** → 13 Dashboard → 14 Auditoria →
   15 Segurança → 16 Deploy.

## Sessão 02/10/2026 (parte 2) — Fase 12: Relatórios (M5) CONCLUÍDA

**Fase 12 — CONCLUÍDA e verificada** (escopo aprovado "tudo de uma vez":
4 relatórios + export CSV). Fases 1–12 prontas.

### O que a Fase 12 entregou
- **F12.1** `src/server/modules/relatorios/report-rules.ts` (regras puras,
  TDD) + `tests/unit/report-rules.test.ts` (**33 testes**): `assertReportTipo`,
  `ReportError`, `normalizeRange` (de > ate = erro pt-BR), classificação
  `CRITICO/BAIXO/OK`, `stockValueCents`, `calcMargin` (% sobre custo, null
  quando custo = 0), `toCsv` (`;` + BOM + CRLF), `csvMoney/csvQty` (pt-BR),
  `paginate/totalPages`, agregadores `aggregateSalesByDay/BySeller/ByProduct`,
  `aggregatePurchasesBySupplier/ByProduct`, `summarizeAccounts`.
- **F12.2** `report.service.ts` — `getStockReport`, `getSalesReport`,
  `getPurchasesReport`, `getFinanceReport` (todos em `TenantTx` + filtros
  `page/pageSize`; `opts.all` ignora paginação p/ CSV). Agregação roda nas
  regras puras — o service só busca fatos.
- **F12.3** `src/lib/validators/relatorios.ts` (Zod compartilhado página/rota)
  + `src/app/api/exports/[tipo]/route.ts` (GET: `assertReportTipo` → 400,
  sessão → 401, tenant → 400, membership → 403, `assertPermission(
  "reports.view")` → 403, `normalizeRange` → 400, CSV `text/csv` +
  `Content-Disposition` + `Cache-Control: no-store`, 500 genérico).
- **F12.4 (UI)** `src/app/(app)/relatorios/page.tsx` (Server Component:
  abas Estoque/Vendas/Compras/Financeiro, KPIs, filtros GET, tabela,
  paginação 20, botão **Exportar CSV** → rota dedicada com os mesmos
  params) + `src/components/relatorios/level-badge.tsx` + item
  "Relatórios" da sidebar liberado com `reports.view`.
- **F12.5** `tests/integration/reports.test.ts` (**11 testes**): RLS A≠B nos
  4 relatórios, agregados batem com o livro (custo/margem/pagamentos),
  filtro de período, paginação vs `all`, classificação BAIXO por mínimo,
  RBAC `reports.view` (ADMIN/GERENTE/FINANCEIRO/VISUALIZADOR ✔ ·
  VENDEDOR/ESTOQUISTA ✗ → 403).
- **F12.6** Gate: `typecheck` ✅ · unit **207** (11 suítes) ✅ · integração
  **81** (8 suítes) ✅ · `build` ✅ (rotas `/relatorios`,
  `/api/exports/[tipo]`).
- **F12.7** Docs (este arquivo + ARQUITETURA **§15 Relatórios**), painel
  (Relatórios "Concluído", roadmap Fase 12 ✓).

### Correções no caminho (Fase 12)
1. `Promise.all` sobre o **mesmo client** de uma transação → warning
   `client.query()` do pg (removido em pg@9). Serializado em
   `report.service.ts` e `relatorios/page.tsx` (sequencial no mesmo `tx`).
2. Links de aba vazavam `groupBy` de outra aba (ex.: `groupBy=dia` em
   Compras que só aceita `fornecedor|produto` → 400). `TAB_KEYS` por tipo.
3. Form enviava `groupBy` duplicado (hidden + select) → virava `string[]`
   e caía no default. Removido o hidden.

### Decisões de modelo (não reabrir)
- Custo do relatório de estoque = **`products.cost_price`** (custo ref.
  cadastrado) — não existe custo médio corrente armazenado.
- Receita por produto (vendas) = linha do item; **desconto de pedido não é
  rateado** por produto (soma só em dia/vendedor).
- Vendas só `BILLED` + `billedAt`; compras só `CONFIRMED` por `entryDate`;
  financeiro por `dueDate` no período (baixas por `paidAt`).
- Datas de agregação por dia = UTC (`T00:00:00.000Z`…`T23:59:59.999Z`).
- Rota CSV: `direction` default `RECEIVABLE`, `groupBy` default `dia/
  fornecedor` (mesmos defaults da UI); `?tipo=` desconhecido/inválido na
  página cai no fallback Estoque (200).
- `ESTOQUISTA`/`VENDEDOR` não têm `reports.view` (matriz da Fase 5) —
  sidebar esconde, servidor nega.

### Validação E2E (Playwright, dev :3001)
- 4 abas com dados reais: Estoque (4 itens, R$1.536,99), Vendas (KPI +
  agrupamento dia/vendedor/produto com vendedores), Compras (2 CONFIRMED,
  R$145,00), Financeiro (4 contas a pagar, badges, parcelas 1/3…3/3,
  origem Compra; contas a receber da `VENDA-000004`).
- Filtros: nível `CRITICO` → "Nenhum resultado"; período `de > ate` →
  banner "Período inválido…" (sem 500); selects preservados na URL.
- CSV: 4 tipos → 200, `text/csv`, BOM na linha de bytes (`ef bb bf`),
  `;`, CRLF, dinheiro pt-BR (`545,19`); sem sessão → 401
  `{"error":"Não autenticado."}`; `groupBy` inválido → 400 com
  `fieldErrors`. Console 0 erros de app.

### Dados de teste no dev (Empresa Demo)
- `VENDA-000004` (R$46,80, BILLED 02/10 13:37, gerou conta
  `VENDA-000004` a receber) — fluxo real pela UI; custos corretos
  (16,50 + 10,69) confirmam o fix do `/1000` da Fase 11. Os 3 movimentos
  antigos (30/09–02/10 01:31) ainda têm `total_cost` ~1000x menor — são
  pré-fix; imutáveis (nunca UPDATE), apagar só se o usuário pedir.

---

## Sessão 02/10/2026 (parte 3) — Fase 13: Dashboard (M5) CONCLUÍDA

### Entregues
- **F13.1 (TDD)** `src/server/modules/dashboard/dashboard-rules.ts` +
  `tests/unit/dashboard-rules.test.ts` — 24 testes: `buildDailySeries`
  (dias zerados UTC, cruza mês/ano, máx. `MAX_SERIES_DAYS` = 366,
  `ReportError` se faltar/inverter data), `summarizeFunnel` (5 status +
  total, ignora desconhecido), `ticketAvgCents` (round, null se 0),
  `rankSellers` (líquido desc, desempate nome, limit) e
  `nextDueAccounts` (só RECEIVABLE em aberto, `dueDate ≥ hoje`, ordenado,
  limit — vencidas de fora).
- **F13.2** `dashboard.service.ts` (`getDashboard`: reusa
  `getSalesReport` dia/vendedor + `getStockReport` + `getFinanceReport`
  e 2 consultas leves — funil por `createdAt` e próximos vencimentos;
  queries **sequenciais** no mesmo tx) +
  `src/lib/validators/dashboard.ts` (Zod, período obrigatório).
- **F13.3** `src/app/(app)/dashboard/page.tsx` (KPIs ×5, gráfico
  `revenue-bars.tsx` SVG/CSS puro, funil com barras, Alertas, Top
  vendedores, Próximos vencimentos com `StatusBadge`, form GET de/ate,
  banner de erro) + item **Dashboard** na sidebar (`reports.view`).
- **F13.4** `tests/integration/dashboard.test.ts` — **7 testes**: RLS
  (B zera com dados de A; B com dados próprios vê os números de B),
  agregados (6000/ticket/série 7 dias/funil BILLED/estoque crítico+báixo
  via `SAIDA_AJUSTE`/próximos vencimentos), parcela vencida →
  inadimplência e some dos próximos, período 2020 zera vendas mas estoque
  é posição atual, RBAC `reports.view`.
- **F13.5 gate**: typecheck ✅ · unit **231** (12 suítes) ✅ ·
  integração **88** (9 suítes) ✅ · `next build` ✅ (rota `/dashboard`).
- **F13.6** docs (esta seção + ARQUITETURA §16 + painel módulos/roadmap).

### Validação E2E (Playwright, dev :3001)
- `/dashboard` logado: período default 03/09→02/10 (30 dias), KPIs
  corretos (R$193,50 = 37,80 + 18,90 + 136,80; ticket R$48,38; a receber
  R$46,80 da VENDA-000004), 30 barras com tooltips, funil 4 (100%
  faturada), top 3 vendedores ordenados, próximo vencimento com badge.
- Erros → banner (sem 500): `de > ate` → "Período inválido…";
  `de=lixo` → "Data inválida."; range > 366 dias → "Período longo
  demais… (máx. 366 dias)".
- Temas **dark e light** validados por screenshot; console 0 erros.

### Decisões de modelo (não reabrir)
- Permissão do dashboard = **`reports.view`** (sem migration nova — mesma
  matriz dos relatórios).
- Período default = **últimos 30 dias UTC** (coerente com filtros de
  `billedAt`); `de`/`ate` obrigatórios após o default; máx. 366 dias
  (limite do gráfico).
- Funil conta o **status atual** de pedidos **criados** no período
  (`createdAt`), não eventos de transição.
- Gráficos em **SVG/CSS puro** — nenhuma lib nova (regra "sem
  biblioteca nova sem alinhar").
- "A receber" = saldo em aberto **total** (sem filtro de período);
  inadimplência = vencida não paga (regra por data, funciona sem cron);
  próximos vencimentos excluem as vencidas (elas aparecem no KPI).

### ▶ PRÓXIMO PASSO (retomar aqui)
1. **Commit/push da Fase 13 — feito** (`83f34e0` em `origin/main`).
2. `npm run backup` (rodar ao fechar a sessão).
3. Depois: **Fase 14 — Auditoria** → 15 Segurança → 16 Deploy.
