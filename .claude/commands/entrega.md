---
description: Verifica checkboxes do PLAN.md, gera relatório de próximos passos e confirma readiness
---

Execute a rotina de encerramento de projeto:

## Passo 1 — Verificar hooks de encerramento
Se existirem hooks em `.claude/hooks/`, verifique se todos executam sem erros.

## Passo 2 — Verificar checkboxes do PLAN.md
Leia `PLAN.md` e verifique o status de cada checkbox `[ ]` / `[x]` em todas as tasks.
Contabilize quantos estão marcados vs. pendentes por sprint.

## Passo 3 — Verificar checkboxes do SPEC.md
Leia `SPEC.md` e verifique o status dos critérios de aceitação.

## Passo 4 — Validar integridade do projeto
- `npm test` deve passar sem falhas
- `npm run build` deve compilar sem erros
- Verifique se `.env.example` está atualizado (mesmas chaves do `.env`)
- Verifique se `AGENTS.md` reflete a estrutura real de pastas

## Passo 5 — Gerar relatório de próximos passos
Produza um relatório markdown com:

```
# Relatório de Entrega

## Resumo
- Sprints concluídas: X de 4
- Tasks concluídas: X de Y
- Testes passando: X de Y

## Sprints
### Sprint 1 — Login e Board
- [x] Task 1.1 — ...
- [ ] Task 1.2 — ...

## Status do Deploy
- [ ] Vercel configurado
- [ ] Supabase conectado
- [ ] Seed executado em produção

## Próximos Passos
1. descrição — baseado nas tasks pendentes do PLAN.md
2. ...
```

## Passo 6 — Confirmar readiness
Se os seguintes itens estiverem OK, declare o projeto **pronto para ser clonado por outra pessoa**:
- [ ] `npm install && cp .env.example .env && npx prisma migrate dev && npx prisma db seed && npm run dev` funciona do zero
- [ ] `npm test` passa
- [ ] `npm run build` compila
- [ ] SPEC.md e AGENTS.md estão atualizados
- [ ] Não há secrets vazados no repositório
