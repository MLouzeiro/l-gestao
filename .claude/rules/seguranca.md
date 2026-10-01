# Regras de Segurança (valem para qualquer agente)

## Isolamento multi-tenant (regra número 1 do projeto)
- `tenant_id` NUNCA vem do corpo/querystring do cliente — sempre da sessão, propagado por `withTenant()`.
- Todo acesso a dados passa por `withTenant()` (transação + `SET LOCAL app.current_tenant_id`) — nunca `db.query` solto.
- Nunca usar `SET` de sessão (sem `LOCAL`) — vaza contexto entre conexões do pool serverless.
- Esquecer o `tenant_id` no WHERE é aceito como camada extra, mas **nunca** substitui a RLS.

## Nunca expor segredos
- Nunca logar tokens de sessão, senhas, `AUTH_SECRET` ou `DATABASE_URL` — nem em `console.log`, nem em responses de erro.
- Senhas nunca em texto puro — apenas o hash gerado pelo Better Auth.
- Erros de banco nunca retornados ao cliente — sempre `catch` genérico com mensagem em pt-BR e 500.
- Stack traces nunca aparecem em responses (nem em desenvolvimento via API).

## Nunca confiar no cliente
- Toda entrada (Server Action, Route Handler, formulário) validada com **Zod no servidor**.
- Limites de desconto, permissões e status de venda validados no servidor — o botão na tela não é segurança.
- Nenhum endpoint permite auto-promoção de papel ou alteração do próprio `role`.

## Registros imutáveis
- Nunca `UPDATE`/`DELETE` em `stock_movements`, `financial_payments`, `audit_logs`.
- Venda `BILLED` não é editada — só devolução/estorno.

## Privilege escalation
- `requirePermission()` obrigatório no início de toda ação sensível (403 no servidor, não só botão escondido).
- Último ADMIN do tenant não pode ser removido/rebaixado.
- Acesso de manutenção (role `migrator` do banco) só em migrations — nunca pela aplicação.
