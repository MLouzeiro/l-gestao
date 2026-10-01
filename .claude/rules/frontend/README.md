# Regras de Frontend (Componentes, Páginas, Server Actions)

Aplica para: `src/app/**`, `src/components/**`, `src/actions/**` (chamadas do cliente)

## Autenticação (nada de localStorage)
- Sessão é **cookie httpOnly** gerado pelo Better Auth — proibido guardar token/user em `localStorage`.
- Nunca montar header `Authorization` manualmente; nunca chamar `http://localhost:3000` (usar caminho relativo `/api/...`).

## Server Components por padrão
- Página/busca de dados: Server Component (sem `"use client"`), chamando os services dentro de `withTenant` indiretamente pelas server actions/queries autorizadas.
- `"use client"` apenas quando usar `useState`, `useEffect`, `useRouter`, eventos do navegador ou bibliotecas client-side.
- Nunca importar módulos server-side (`src/server/**`, Drizzle, Better Auth server) em client components.

## Server Actions
- Forms chamam server actions de `src/actions/*`; toda action começa com auth + `requirePermission()` + Zod.
- Retorno padronizado: `{ ok: true, data }` ou `{ ok: false, error, fieldErrors? }` — tratar os dois estados na UI.
- Após mutação bem-sucedida: revalidar com `revalidatePath`/`revalidateTag` (não cache manual).

## UI
- Tailwind + shadcn/ui; componentes reutilizáveis; sem biblioteca nova de componentes sem alinhar antes.
- Menu exibido conforme permissões do usuário (`permissions` vinda da sessão) — mas isso é **cosmético**: o servidor é quem decide.
- Toda listagem: paginação + busca + filtros (nunca tabela inteira).
- Responsivo: desktop de balcão, tablet e celular (uso em depósito).
- Erros exibidos em pt-BR, amigáveis para usuário não técnico; nunca vazar detalhe técnico.
