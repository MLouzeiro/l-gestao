---
description: >-
  Recebe solicitação de melhoria, faz perguntas de clarificação, monta plano
  em sprints/fases/tasks e delega implementação via /implementar
---

# Comando /melhoria

Você recebeu a seguinte solicitação de melhoria:

> **$ARGUMENTS**

Seu objetivo é **entender, planejar e delegar a implementação** desta melhoria,
usando o agente `general` como orquestrador para gerenciar a execução.

---

## Fase 1 — Clarificação (faça perguntas)

Faça **pelo menos 2 perguntas** ao usuário para entender melhor o escopo.
Escolha as mais relevantes para o contexto da solicitação:

- Qual o objetivo principal desta melhoria? Qual problema ela resolve?
- Quem são os usuários que vão interagir com ela? (Dono, Gestor, Vendedor)
- Ela depende de alguma funcionalidade existente no sistema?
- Deve ter restrição de acesso (RBAC)?
- Precisa de testes automatizados?
- Qual a prioridade? (agora, próximo sprint, futuro)
- Há requisitos de UI/UX específicos?
- Deve ser visível em quais páginas? (Board, Dashboard, Relatórios, Vendedores)

Somente prossiga após obter respostas suficientes para planejar.

---

## Fase 2 — Análise do código-fonte

Antes de montar o plano, leia e entenda:

1. `@SPEC.md` — requisitos funcionais do sistema
2. `@PLAN.md` — plano existente de implementação
3. `@AGENTS.md` — estrutura do projeto e convenções
4. `prisma/schema.prisma` — modelos de dados existentes
5. `src/types/index.ts` — tipos TypeScript do sistema
6. `src/constants/` — constantes (pipeline, roles, etc.)

Identifique:
- Onde a melhoria se encaixa na arquitetura atual
- Se há modelos de dados que precisam ser criados/alterados
- Quais endpoints de API serão necessários
- Quais componentes de frontend precisam ser criados/modificados
- Se há conflitos com o plano existente

---

## Fase 3 — Montar plano detalhado

Crie um arquivo em `docs/planos/<nome-do-plano>.md` com:

```markdown
# <Nome da Melhoria>

**Solicitação:** $ARGUMENTS

**Data:** <data atual>

---

## Sprint 1 — <Nome da Sprint>

### Fase 1.1 — <Nome da Fase>
> Dependências: <lista>
> Paralelismo: sequencial | paralelo
> Agente orquestrador: general

#### Task 1.1.1 — <Título>
- **Agent:** <backend-auth | backend-crud | backend-metrics | frontend-core | frontend-auth | frontend-kanban | frontend-admin | infra | general>
- **Input:** <pré-requisitos>
- **Output esperado:** <arquivos a criar/modificar>
- **Testes críticos:**
  - [ ] <critério de teste 1>
  - [ ] <critério de teste 2>

---

## Resumo de paralelismo e agents

### Tasks que rodam em paralelo
| Momento | Tasks |
|---------|-------|

### Sequência de implementação
| Ordem | Task | Agent |
|-------|------|-------|

### Critérios de conclusão
| Sprint | Critério |
|--------|----------|
```

Regras do plano:
- Dividir em **Sprints** (cada sprint entrega algo funcional e testável)
- Cada sprint tem **Fases** (agrupamento lógico com dependências)
- Cada fase tem **Tasks** com agent designado, input, output esperado e testes críticos
- Indicar **paralelismo** explícito (quais tasks rodam juntas)
- Usar os agents disponíveis nos diretórios `.opencode/agents/` e `.claude/agents/`
- Incluir **testes críticos** em checklist `- [ ]` em cada task
- A primeira sprint deve sempre começar com backend (modelos + API) antes do frontend
- Tasks de frontend dependem das tasks de backend da mesma fase

---

## Fase 4 — Delegar implementação

Após o plano ser aprovado pelo usuário, delegue a implementação:

### Para cada Sprint (em ordem):
1. Execute `/entrega` para verificar o estado atual do projeto
2. Para cada task da sprint, na ordem correta:
   - Use o agente `general` para orquestrar a chamada
   - Execute `/implementar <Task ID>`
   - Verifique se a task foi concluída com sucesso
   - Em caso de falha, reporte e pergunte ao usuário como proceder

3. Ao final de cada sprint:
   - Execute `npm test` para garantir que nada quebrou
   - Execute `npm run build` para verificar compilação
   - Execute `/review` para revisar o que foi implementado
   - Atualize o plano em `docs/planos/` marcando as tasks concluídas

### Após todas as sprints:
- Execute `/entrega` para relatório final
- Atualize `@PLAN.md` se aplicável
- Atualize `@SPEC.md` se a melhoria adicionar novos requisitos

---

## Regras importantes

- **Nunca implemente diretamente** — use `/implementar` para cada task
- **O agente `general` é o orquestrador** — ele gerencia a execução das tasks
- **Não pule sprints** — implemente na ordem do plano
- **Valide cada task** antes de passar para a próxima
- **Se o plano precisar de ajustes**, pergunte ao usuário antes de alterar
