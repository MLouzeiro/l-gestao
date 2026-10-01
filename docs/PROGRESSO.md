# L Gestão — Progresso (sessão de trabalho)

> Atualizado em: 30/09/2026. Estado salvo para retomar a sessão seguinte.

**Nome do sistema: L Gestão** (slug `l-gestao`, URL `l-gestao.vercel.app`;
conceito: L de Louzeiro + gestão — estoque · vendas · financeiro).

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
