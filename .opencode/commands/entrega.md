---
description: Verifica checkboxes do PLAN.md, gera relatório de próximos passos e confirma readiness
---

Execute a rotina de encerramento de projeto:

## Passo 1 — Verificar hooks de encerramento
Se existirem hooks em `.claude/hooks/` ou `.opencode/hooks/`, verifique se todos executam sem erros.

## Passo 2 — Verificar checkboxes do PLAN.md
Leia `@PLAN.md` e verifique o status de cada checkbox `[ ]` / `[x]` em todas as tasks.
Contabilize quantos estão marcados vs. pendentes por sprint.

## Passo 3 — Verificar checkboxes do SPEC.md
Leia `@SPEC.md` e verifique o status dos critérios de aceitação.

## Passo 4 — Validar integridade do projeto
- `!npm test -- --silent 2>&1` deve passar sem falhas
- `!npm run build 2>&1` deve compilar sem erros
- Verifique se `.env.example` está atualizado (mesmas chaves do `.env`): !`Compare-Object (Select-String -Path .env.example | ForEach-Object { $_ -replace '=.*', '' }) (Select-String -Path .env | ForEach-Object { $_ -replace '=.*', '' }) 2>&1`
- Verifique se `@AGENTS.md` reflete a estrutura real de pastas: !`Get-ChildItem -Recurse -Directory src/app/api src/components src/hooks src/lib src/constants src/types prisma __tests__ | Select-Object -ExpandProperty FullName 2>&1`
- Verifique se `@README.md` existe e está atualizado (se aplicável)

## Passo 5 — Gerar relatório de próximos passos
Produza um relatório markdown com:

```
# Relatório de Entrega

## Resumo
- Sprints concluídas: X de 4
- Tasks concluídas: X de Y
- Testes passando: !npm test

## Sprints
### Sprint 1 — Login e Board
- [x] Task 1.1 — ...
- [ ] Task 1.2 — ...

## Status do Deploy
- [ ] Vercel configurado
- [ ] Supabase conectado
- [ ] Seed executado em produção

## Próximos Passos
1. [descrição da próxima task] — baseado nas tasks pendentes do PLAN.md
2. ...
```

## Passo 6 — Confirmar readiness
Se os seguintes itens estiverem OK, declare o projeto **pronto para ser clonado por outra pessoa**:
- [ ] `npm install && cp .env.example .env && npx prisma migrate dev && npx prisma db seed && npm run dev` funciona do zero
- [ ] `npm test` passa
- [ ] `npm run build` compila
- [ ] SPEC.md e AGENTS.md estão atualizados
- [ ] Não há secrets vazados no repositório (!`git log --all --diff-filter=A --follow -p -- '.env' 2>&1 | Select-String -Pattern 'JWT_SECRET|DATABASE_URL' -SimpleMatch`)
