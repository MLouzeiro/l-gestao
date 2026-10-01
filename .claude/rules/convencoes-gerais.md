# Convenções Gerais (valem para qualquer agente)

## Formato de resposta (API/Server Actions)
- Erros: `{ error: "mensagem descritiva em português" }` + status adequado (400/401/403/404/500).
- Sucesso: dado direto sem wrapper — objeto ou array.
- Validação Zod falhou → 400 com mensagens de campo (`{ fieldErrors }`).

## Datas e números
- Datas em ISO string no JSON; colunas `timestamptz` no banco.
- **Dinheiro**: banco `numeric(14,2)`; TypeScript em **centavos (integer)** via `@/lib/money.ts` — proibido float.
- **Quantidades**: `numeric(14,3)` — tratar como decimal, não inteiro.

## Imports
- Sempre alias `@/` — nunca caminhos relativos (`../../`).
- Ex.: `@/server/tenant/with-tenant`, `@/server/db/schema/...`, `@/lib/money`, `@/components/...`.

## Estrutura Next.js (App Router)
- Mutações via **Server Actions** (`"use server"`) na pasta `src/actions/`; Route Handlers (`route.ts` com `GET/POST/...`) só para: auth Better Auth, exports CSV, webhooks, cron.
- Páginas `page.tsx` com `export default`; layouts `layout.tsx`; nunca misturar com Pages Router.
- Componentes de servidor por padrão; `"use client"` só quando usar hooks/estado/eventos.

## Validação e tipos
- Schema Zod em `src/lib/validators/` compartilhado entre cliente e servidor (a validação do servidor é a que vale).
- TypeScript strict, nenhum `any`; tipos vindos do Drizzle (`InferSelectModel`).
- Toda query Drizzle que lê dados de negócio filtra por `tenant_id` além da RLS.
