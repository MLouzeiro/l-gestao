---
name: api-route-pattern
description: >-
  Gera API Routes completas seguindo as convenções do projeto: auth JWT via
  getAuthUser, RBAC com ROLES (DONO/GESTOR podem tudo, VENDEDOR só seus dados),
  validação de entrada, filtro por userId, tratamento de erros com try/catch,
  e estrutura de pastas `/api/{recurso}/[id]/route.ts`.
---

# Skill: API Route Pattern

Cria ou modifica **API Routes (Next.js App Router Route Handlers)** seguindo
as convenções estabelecidas em `AGENTS.md` e o código existente do projeto.

## Estrutura de pastas

| Recurso | Arquivo |
|---------|---------|
| Listar/Criar | `src/app/api/{recurso}/route.ts` |
| Item específico | `src/app/api/{recurso}/[id]/route.ts` |
| Sub-recurso | `src/app/api/{recurso}/[id]/{sub}/route.ts` |
| Ação | `src/app/api/{recurso}/{acao}/route.ts` |

## Template de código

### Rota de lista/criação (`route.ts`)

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { ROLES } from "@/constants/roles";

export async function GET(request: Request) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // VENDEDOR só vê recursos próprios; DONO/GESTOR veem tudo
    const where = user.role === ROLES.VENDEDOR
      ? { userId: user.userId }
      : {};

    const data = await prisma.{model}.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Opcional: restringir POST apenas para DONO/GESTOR
    if (user.role === ROLES.VENDEDOR) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await request.json();
    const { campoObrigatorio1, campoObrigatorio2, opcional1 } = body;

    // Validar campos obrigatórios
    if (!campoObrigatorio1 || !campoObrigatorio2) {
      return NextResponse.json(
        { error: "campoObrigatorio1 e campoObrigatorio2 são obrigatórios" },
        { status: 400 }
      );
    }

    const created = await prisma.{model}.create({
      data: {
        campoObrigatorio1,
        campoObrigatorio2,
        opcional1: opcional1 || null,
        // userId: user.userId  // se for recurso do próprio usuário
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
```

### Rota de item específico (`[id]/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { ROLES } from "@/constants/roles";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const item = await prisma.{model}.findUnique({ where: { id } });
    if (!item) {
      return NextResponse.json(
        { error: "{Model} não encontrado" },
        { status: 404 }
      );
    }

    // VENDEDOR só acessa recursos próprios
    if (user.role === ROLES.VENDEDOR && item.userId !== user.userId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    return NextResponse.json(item);
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const item = await prisma.{model}.findUnique({ where: { id } });
    if (!item) {
      return NextResponse.json(
        { error: "{Model} não encontrado" },
        { status: 404 }
      );
    }

    // VENDEDOR só edita recursos próprios
    if (user.role === ROLES.VENDEDOR && item.userId !== user.userId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await request.json();

    // Montar apenas campos enviados (PATCH parcial)
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    // ... demais campos

    const updated = await prisma.{model}.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // DELETE geralmente só DONO/GESTOR
    if (user.role === ROLES.VENDEDOR) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const item = await prisma.{model}.findUnique({ where: { id } });
    if (!item) {
      return NextResponse.json(
        { error: "{Model} não encontrado" },
        { status: 404 }
      );
    }

    await prisma.{model}.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
```

## Regras de RBAC (extraídas do código existente)

| Perfil | GET lista | GET item | POST | PATCH | DELETE |
|--------|-----------|----------|------|-------|--------|
| **DONO** | Tudo | Tudo | Tudo | Tudo | Tudo |
| **GESTOR** | Tudo | Tudo | Tudo | Tudo | Tudo |
| **VENDEDOR** | Só próprio | Só próprio | Negado* | Só próprio | Negado |

*\* Exceção: leads podem ser criados por VENDEDOR com userId explícito (atribuição via Dono/Gestor). Verificar regra de negócio específica.*

## Convenções de resposta

| Situação | HTTP | body |
|----------|------|------|
| Sucesso lista | `200` | `[...]` |
| Sucesso criação | `201` | `{ ... }` |
| Sucesso deleção | `200` | `{ "success": true }` |
| Não autenticado | `401` | `{ "error": "Não autenticado" }` |
| Acesso negado (role) | `403` | `{ "error": "Acesso negado" }` |
| Recurso não encontrado | `404` | `{ "error": "{Model} não encontrado" }` |
| Dados inválidos | `400` | `{ "error": "mensagem descritiva" }` |
| Erro interno | `500` | `{ "error": "Erro interno do servidor" }` |

## Exemplos de input e output

### Input (agente recebe instrução do usuário)

> "Crie a rota PATCH /api/leads/move para mover leads entre etapas"

### Output esperado (agente aplica a skill e gera)

Consulta `src/constants/pipeline.ts` para saber as stages válidas,
`src/constants/roles.ts` para os roles, e gera:

```typescript
// src/app/api/leads/move/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { ROLES } from "@/constants/roles";
import { PIPELINE_STAGES } from "@/constants/pipeline";

export async function PATCH(request: Request) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json();
    const { leadId, targetStage } = body;

    if (!leadId || !targetStage) {
      return NextResponse.json(
        { error: "leadId e targetStage são obrigatórios" },
        { status: 400 }
      );
    }

    if (!PIPELINE_STAGES.includes(targetStage)) {
      return NextResponse.json(
        { error: `Stage inválido. Valores: ${PIPELINE_STAGES.join(", ")}` },
        { status: 400 }
      );
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    }

    if (user.role === ROLES.VENDEDOR && lead.userId !== user.userId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { stage: targetStage },
    });

    return NextResponse.json({ lead: updated });
  } catch {
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
```

### Input (agente recebe instrução do usuário)

> "Crie o CRUD de observações em /api/leads/[id]/observacoes"

### Output esperado (agente aplica a skill)

Gera `src/app/api/leads/[id]/observacoes/route.ts` com GET (listar
observações do lead, com verificação de propriedade do lead) e POST
(criar observação com autor = usuário logado), seguindo o template
acima com `prisma.observacao`.

## Quando NÃO usar esta skill

- **Testes** (`__tests__/`) — usar a skill `rbac-test-pattern` em vez desta
- **Páginas React** (`src/app/*/page.tsx`) — não são API Routes
- **Componentes** (`src/components/`) — não são API Routes
- **Bibliotecas/utilitários** (`src/lib/`) — usar convenções de `src/lib/`
- **Rotas que não seguem REST** (ex: WebSockets, webhooks) — fogem do padrão
- **Middleware de Next.js** (`src/middleware.ts`) — usa `NextMiddleware`, não `Route Handler`
