---
description: Implementa uma task do PLAN.md por ID, executa TDD e dispara code-reviewer ao final
---

Você recebeu a task "{input}".

## Passo 1 — Ler o PLAN.md
Leia `PLAN.md` e localize a task especificada.
Identifique:
- O **agent** correto dos disponíveis em `.claude/agents/`
- A **fase** e **dependências**
- O **output esperado** (arquivos a criar/modificar)
- Os **testes críticos** que precisam passar

## Passo 2 — Validar dependências
Verifique se as tasks das quais esta depende já foram concluídas. Se alguma dependência estiver faltando, avise o usuário e pare.

## Passo 3 — Implementar com TDD
1. Primeiro, escreva os **testes** correspondentes à task (em `__tests__/`)
2. Execute `npm test` — eles devem falhar (RED)
3. Implemente o código necessário usando o agent correto de `.claude/agents/`
4. Execute `npm test` novamente — devem passar (GREEN)
5. Execute `npm run build` para verificar compilação

## Passo 4 — Rodar testes completos
Execute `npm test` completo para garantir que nada quebrou.

## Passo 5 — Code Review automático
Chame o @code-reviewer para revisar especificamente esta task e seu impacto no resto do sistema.

## Passo 6 — Gerar documentação
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
