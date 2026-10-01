# Estoque + Vendas + Financeiro (SaaS Multi-Empresa)
> Sistema multi-tenant (shared schema + `tenant_id` + RLS) para controle de estoque, vendas e financeiro de múltiplas empresas, com suporte a lote/validade (farmácia/laboratório/saúde) ativável por empresa. Hospedado na Vercel + Neon.
> Arquitetura aprovada: `docs/ARQUITETURA.md` — é a fonte de verdade.

## Stack
| Camada | Tecnologia |
|--------|------------|
| Framework | Next.js (App Router) + TypeScript |
| Frontend | React + Tailwind CSS + shadcn/ui (Server Components) |
| Backend | Server Actions + Route Handlers |
| Banco | PostgreSQL (Neon em produção, Docker local em dev) |
| ORM | Drizzle ORM (migrations SQL em `drizzle/`) |
| Autenticação | Better Auth (sessões em DB, 2FA, convites, organizações = tenants) |
| Isolamento | RLS + `SET LOCAL app.current_tenant_id` + filtro `tenant_id` nas queries |
| Validação | Zod em toda entrada de dados |
| Testes | Jest + Testing Library (unit) e Jest + Postgres real (integração/RLS) |
| Deploy | Vercel (development / preview / production) |

## Estrutura de pastas

```
/
├── drizzle/                    # Migrations SQL versionadas (nunca editar SQL gerado)
├── src/
│   ├── app/
│   │   ├── (auth)/login/       # Telas públicas
│   │   ├── (app)/              # Área protegida: dashboard, estoque, vendas, financeiro, relatorios, admin
│   │   └── api/                # Better Auth, exports CSV, cron
│   ├── server/
│   │   ├── db/schema/          # Schema Drizzle (1 arquivo por domínio)
│   │   ├── db/client.ts        # Pool Neon/pg
│   │   ├── auth/               # better-auth.ts, guards
│   │   ├── tenant/with-tenant.ts   # ⭐ SET LOCAL + transação (obrigatório em todo acesso a dados)
│   │   ├── rbac/               # permissions.ts, require-permission.ts
│   │   ├── modules/estoque|vendas|financeiro|compras/   # regras de negócio
│   │   └── audit/log.ts        # log append-only
│   ├── actions/                # Server Actions (uma pasta por módulo)
│   ├── components/             # ui/ (shadcn), layout/, estoque/, vendas/, financeiro/
│   ├── lib/                    # money.ts (centavos), csv.ts, validators
│   └── types/
├── scripts/seed.ts
├── tests/
│   ├── unit/                   # Regras de negócio puras
│   └── integration/            # DB real: RLS, movimentações, financeiro
├── docs/                       # ARQUITETURA.md, README.md, DATABASE.md, SECURITY.md…
├── .env                        # Nunca versionado (usar .env.example como template)
└── AGENTS.md                   # Este arquivo
```

## Como rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Variáveis de ambiente
cp .env.example .env
# Editar .env (DATABASE_URL do Docker local ou Neon)

# 3. Banco de dados (Docker local)
docker compose up -d
npm run db:migrate      # aplica as migrations
npm run db:seed         # cria tenant demo + papéis/permissões

# 4. Desenvolvimento
npm run dev

# Testes
npm test                # unitários
npm run test:integration  # precisa do banco de teste

# Backup (Google Drive) — ver seção própria abaixo
npm run backup
```

## Migrations (drizzle)

- Migrations custom escritas à mão (ex.: `0001_rls_tenant_isolation`, `0005_grants_app_role`) precisam de **entrada manual em `drizzle/meta/_journal.json`** — sem a entrada, o `db:migrate` ignora o arquivo em silêncio.
- **GRANTs do papel da app (`estoque_app`) são a migration `0005`** — nunca aplicar `GRANT` só na mão (banco novo/nasce sem permissão → `permission denied for table ...` nos testes de integração).
- Suíte de integração: `npm run test:integration` (Jest + `jest.config.integration.ts`) **recria o banco `estoque_test` do zero** no `globalSetup` (drop/create + `drizzle-kit migrate`) e aponta `DATABASE_URL` para `DATABASE_URL_TEST` via `setupFiles` — exige Docker local; os workers NÃO devem tocar no banco de desenvolvimento.

## Backup (Google Drive) — regra obrigatória

- Espelho: `C:\Users\Louzeiro\Projeto\Estoque` (trabalho) → `H:\Meu Drive\Projeto\Estoque` (backup).
- Comando: `npm run backup` (`scripts/backup.ps1`, robocopy `/MIR`; exclui `node_modules`, `.next`, `coverage` — regeneráveis).
- **Rodar `npm run backup` ao final de cada sessão/marco entregue** e antes/ depois de mudanças grandes.
- **Nunca editar nada dentro de `H:\Meu Drive\Projeto\Estoque`** — é só destino; o espelho apaga o que existir apenas lá.
- O backup inclui `.env` (conterá segredos reais após a Fase 3) — nunca compartilhar essa pasta fora do Drive pessoal.

## Padrões de código

- Arquivos: kebab-case (`movement.service.ts`), componentes React PascalCase.
- Identificadores de banco/código em inglês; interface do usuário em pt-BR.
- Imports sempre com alias `@/` — nunca caminhos relativos (`../../`).
- **Dinheiro**: banco `numeric(14,2)`, TypeScript em centavos (`integer`) via `lib/money.ts` — nunca `float`/`number` com decimais.
- **Quantidades**: `numeric(14,3)`.
- Toda Server Action começa com `getSession()` + `requirePermission(...)` e roda dentro de `withTenant()`.
- Validação de entrada com Zod no servidor — nunca confiar no cliente.
- TypeScript strict; tipos do Drizzle gerados (`InferSelectModel`) — nenhum `any`.

## TDD

- Framework: Jest (unit) + Jest/Postgres (integração).
- Onde ficam: `tests/unit/` e `tests/integration/`.
- Regra: regra de negócio nova nasce com teste antes da implementação (RED → GREEN).
- Testes críticos obrigatórios:
  - [ ] Empresa A não lê/edita dados de Empresa B (RLS: 0 linhas)
  - [ ] Entrada 10 + saída 3 = saldo 7
  - [ ] Estoque 100, reserva 20 → disponível 80; cancelar → 100
  - [ ] Venda faturada baixa estoque e gera conta a receber
  - [ ] Entrada de compra gera conta a pagar
  - [ ] Vendedor não executa operação de admin (403)
  - [ ] Venda usa lote FEFO quando `controle_fefo` ativo
  - [ ] Lote vencido é bloqueado quando `bloqueio_venda_vencido` ativo
  - [ ] Custo médio: 10@R$10 + 10@R$12 → R$11

## Nunca fazer

- **Nunca** aceitar `tenant_id` vindo do cliente — sempre da sessão, via `withTenant()`.
- **Nunca** acessar o banco fora de `withTenant()` (perde o `SET LOCAL` da RLS → 0 linhas ou, pior, acesso sem contexto).
- **Nunca** usar `SET` de sessão (sem `LOCAL`) — vaza contexto entre conexões do pool serverless.
- **Nunca** editar saldo de estoque direto — todo ajuste é uma movimentação nova (estorno/ajuste).
- **Nunca** apagar/atualizar `stock_movements`, `financial_payments` ou `audit_logs` — são imutáveis.
- **Nunca** editar uma venda já FATURADA — correção é devolução/estorno.
- **Nunca** calcular valor financeiro "na tela" sem persistir o lançamento.
- **Nunca** esconder permissão só no frontend — sempre `requirePermission()` no servidor.
- **Nunca** comitar `.env` com credenciais; nunca logar senhas/tokens.
- **Nunca** usar `DROP`/`TRUNCATE`/`DELETE` geral sem autorização explícita.
- **Nunca** pular a validação Zod de qualquer entrada vinda do cliente.

## Regras por módulo

### M1 — Auth, Empresas, Usuários (Fases 3–5)
- Better Auth: sessão em banco (revogável), 2FA obrigatório para ADMIN, convite por e-mail.
- Criação de tenant popula: `tenant_settings` padrão, papéis-sistema e suas permissões (seed).
- Papel é por empresa (`members.role`); um usuário pode ter papéis diferentes em empresas diferentes.
- Último ADMIN de um tenant não pode ser removido/rebaixado.

### M2 — Estoque (Fases 6–9)
- Todo saldo passa por `applyMovement()` (livro + cache na mesma transação).
- Custo médio móvel padrão; FIFO opcional por tenant (`custo_metodo`).
- FEFO na sugestão de saída quando `controle_fefo` ativo; bloqueio de vencido conforme `bloqueio_venda_vencido`.
- Transferência = saída + entrada ligadas ao mesmo `transfer_id`.
- Reserva: CONFIRMADO reserva, FATURADO consome, CANCELADO/EXPIRADO libera.

### M3 — Vendas (Fase 10)
- Máquina de estados `DRAFT → CONFIRMED → BILLED → CANCELLED/RETURNED` — transições validadas no servidor.
- Desconto por item/pedido limitado pelo papel (`tenant_settings.max_desconto_*`).
- Kits baixam componentes no faturamento.

### M4 — Financeiro (Fase 11)
- Parcelas geradas no faturamento (a receber) e na entrada de compra (a pagar).
- Baixa via `financial_payments`; `paid_amount ≤ amount` (CHECK + validação).
- Status recalculado a cada baixa; `OVERDUE` por cron.

### M5 — Auditoria e Relatórios (Fases 12–14)
- `audit()` em toda mutação sensível; tabela só INSERT.
- Relatórios sempre paginados/filtrados; export CSV via rota dedicada.

### RAG — Sistema de Memória (harness)
- Banco SQLite em `.claude/rag.db` via `better-sqlite3`; scripts em `.claude/scripts/`.
- Popular: `npx ts-node -P tsconfig.rag.json .claude/scripts/embed.ts <dir|file>`
- Consultar: `npx ts-node -P tsconfig.rag.json .claude/scripts/search.ts <query>`
- Plugin hooks em `.opencode/plugin/agent-hooks.ts` injeta contexto RAG na compactação.

## Decisões aprovadas (resumo — detalhe em docs/ARQUITETURA.md §14)
Drizzle · Better Auth · Neon · nota de entrada simples (v1) · seleção de empresa pós-login · Jest · BRL único · sem cálculo fiscal na v1 · CSV na v1.

## Better Auth 1.7.x — armadilhas já resolvidas (não reabrir)
- Login: `authClient.signIn.email({ email, password })` (não existe mais `signIn.emailPassword`).
- `advanced.database.generateId: false` — senão o Better Auth gera id string e explode no PK uuid (o banco gera via `gen_random_uuid`).
- Tabela `accounts`: chave no Drizzle precisa ser `accountId` (exigência do adapter); a coluna SQL pode continuar `provider_account_id`.
- **Não** definir `BETTER_AUTH_URL` em dev (porta do Next varia → 403 "Invalid origin" no sign-in/sign-out do navegador); em produção, definir na Vercel.
- CSP/CSRF: POSTs de auth exigem header `Origin` igual à origem da app (navegador envia automático).
- Organizações (Fase 4): plugin `organization()` com `creatorRole: "ADMIN"` + `roles` (statements via `createAccessControl`); hook `organizationHooks.afterCreateOrganization` provisiona tenant_settings/papéis/permissões; rotas do plugin ficam em `/api/auth/organization/*`; tenants precisa da coluna `metadata` (jsonb) e invitations de `inviter_id` (plugin exige); criação via `createOrganization` grava empresa ativa no BANCO mas não atualiza o cookie (cookieCache) — chamar `setActiveOrganization` em seguida.
- Convites (Fase 5): o MÉTODO do SDK é `auth.api.createInvitation` mas a ROTA é `POST /api/auth/organization/invite-member` (nome ≠ caminho); aceite (`accept-invitation`) exige `emailVerified` por padrão — option `requireEmailVerificationOnInvitation: false` no `organization()` (v1 sem SMTP); `getInvitation` é GET com query `{id}` (rota `/organization/get-invitation`); `removeMember` aceita `memberIdOrEmail` — para admin usar o **id do membro**, não do user.
- Guard do último ADMIN: o próprio plugin já bloqueia (regra `creatorRole`, mensagens `...WITHOUT_AN_OWNER`) ANTES dos hooks `beforeRemoveMember`/`beforeUpdateMemberRole`; nossos hooks ficam como 2ª camada com mensagem pt-BR (regra testada em `tests/unit/admin-rules.test.ts`).
- 2FA (Fase 5): colunas exigidas — `users.twoFactor_enabled` NOT NULL DEFAULT false e em `two_factors`: `verified`/`failed_verification_count` (NOT NULL + default) e `method` com DEFAULT (o plugin não escreve `method`); fluxo: `twoFactor.enable({password})` retorna `{method, totpURI, backupCodes}` (códigos aparecem UMA vez) → `twoFactor.verifyTotp({code})` seta `verified` + `twoFactorEnabled` (só no verify!); login com 2FA ativo: sign-in retorna `{twoFactorRedirect:true}` → cliente redireciona para `twoFactorPage` → `verifyTotp` com o MESMO cookie jar (estado pendente); `disable({password})` precisa de sessão válida; **`POST /two-factor/verify-backup-code` NÃO seta `verified`/`twoFactorEnabled`** (retorna 200 e engana — testado na Fase 6): para ativar de verdade usar `verify-totp` com código TOTP real; o `users.two_factor_enabled` só muda no verify, então uma sessão aberta ANTES do verify continua sendo tratada pelo layout como "sem 2FA" → re-logar depois de ativar.
