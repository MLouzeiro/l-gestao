---
description: Implementa uma task do PLAN.md por ID ou cria plano e implementa uma descrição livre
argument-hint: <Task ID> (ex: "Task 1.1") ou descrição da funcionalidade
---

Você recebeu a solicitação: "$ARGUMENTS"

Determine se o input é um **Task ID** (ex: "Task 1.1", "Task 7.4", "Sprint 2") ou uma **descrição livre** de uma funcionalidade.

---

## FLUXO A — Input é Task ID

### Passo 1 — Ler o PLAN.md
Leia `@PLAN.md` e localize a task especificada.
Identifique:
- O **agent** correto (backend-auth, backend-crud, backend-metrics, frontend-core, frontend-auth, frontend-kanban, frontend-admin, infra)
- A **fase** e **dependências**
- O **output esperado** (arquivos a criar/modificar)
- Os **testes críticos** que precisam passar

### Passo 2 — Validar dependências
Verifique se as tasks das quais esta depende já foram concluídas. Cheque se os arquivos de output esperados existem. Se alguma dependência estiver faltando, avise o usuário e pare.

### Passo 3 — Implementar com TDD
1. Primeiro, escreva os **testes** correspondentes à task (em `__tests__/`)
2. Execute os testes com `!npm test -- --silent 2>&1` — eles devem falhar (RED)
3. Implemente o código necessário seguindo as convenções de `@AGENTS.md` e as regras em `.claude/rules/`
4. Execute os testes novamente — devem passar (GREEN)
5. Execute `!npm run build 2>&1` para verificar compilação

### Passo 4 — Rodar testes completos
Execute `!npm test -- --silent 2>&1` para garantir que nada foi quebrado em outras partes.

### Passo 5 — Code Review automático
Execute o comando `/review` para revisar especificamente esta task e seu impacto no resto do sistema.

### Passo 6 — Gerar documentação
Crie dois relatórios com a data atual no nome (ex: `feature-2026-05-31.md`):

1. **Relatório técnico** → `docs/docs/tecnico/feature-<data>.md`
   - Descreva tecnicamente o que foi implementado: arquivos criados/modificados, endpoints, modelos de dados, lógica de negócio, decisões técnicas
   - Inclua diagrama ASCII ou textual do fluxo se aplicável
   - Liste as dependências e pacotes envolvidos

2. **Relatório de uso** → `docs/docs/uso/feature-<data>.md`
   - Documentação orientada ao usuário leigo (vendedor, gestor)
   - Explique como usar a funcionalidade em passos simples
   - Inclua prints/texto explicativo dos campos, botões e telas
   - Use linguagem não-técnica ("clique em Novo Lead" em vez de "POST /api/leads")

Crie os diretórios se não existirem.

---

## FLUXO B — Input é descrição livre de funcionalidade

### Passo 1 — Clareza (máximo 3 perguntas)
Se necessário, faça ATÉ 3 perguntas objetivas ao usuário para entender melhor o escopo.
Perguntas possíveis (escolha as mais relevantes):
- Qual o objetivo principal dessa funcionalidade?
- Quem são os usuários que vão acessá-la? (Dono, Gestor, Vendedor)
- Ela depende de alguma funcionalidade existente?
- Quais campos/modelos de dados são necessários?
- Deve ter restrição de acesso (RBAC)?
- Precisa de testes automatizados?

Após obter as respostas, siga para o Passo 2.

### Passo 2 — Criar plano em docs/planos/
Crie um arquivo em `docs/planos/<nome-do-plano>.md` seguindo o padrão de `@PLAN.md`:

Estrutura obrigatória:
```markdown
# <Nome do Plano>

---

## Sprint 1 — <Nome da Sprint>

### Fase 1 — <Nome da Fase>
> Dependências: <lista>
> Paralelismo: <sequencial ou paralelo>

#### Task 1.1 — <Título>
- Agent: <backend-auth | backend-crud | backend-metrics | frontend-core | frontend-auth | frontend-kanban | frontend-admin | infra>
- Input: <pré-requisitos>
- Output: <arquivos>
- Testes críticos:
  - [ ] <critério>

---

## Resumo de paralelismo e agents

### Tasks que rodam em paralelo
| Momento | Tasks |
|---------|-------|

### Critérios de conclusão
| Sprint | Critério |
|--------|---------|
```

Regras do plano:
- Dividir em **Sprints** (cada sprint entrega algo funcional e testável)
- Cada sprint tem **Fases** (agrupamento lógico com dependências)
- Cada fase tem **Tasks** com agent designado, input, output esperado e testes críticos
- Indicar **paralelismo** explícito (quais tasks rodam juntas)
- Usar os agents disponíveis: backend-auth, backend-crud, backend-metrics, frontend-core, frontend-auth, frontend-kanban, frontend-admin, infra
- Incluir **testes críticos** em checklist `- [ ]` em cada task

### Passo 3 — Implementar o plano
Para cada task do plano criado, execute o mesmo fluxo do **FLUXO A** (Passos 1 a 5):
1. Para cada task, implemente com TDD (testes primeiro → RED → código → GREEN)
2. Rode `!npm test -- --silent 2>&1` completo
3. Execute `/review` ao final para revisar tudo
