---
description: Recebe relatório de análise de bug, orquestra correção e produz relatório final em docs/bugs/
argument-hint: <caminho do relatório de análise>
---

Você recebeu o relatório de análise para correção: "$ARGUMENTS"

Leia o arquivo de análise em `$ARGUMENTS` (use `@` para ler o conteúdo).

Extraia do relatório:
- **Causa raiz** e **localização** (arquivo:linha)
- **Solução proposta**
- **Gravidade**

---

## Passo 1 — Preparar ambiente para correção

Siga **rigorosamente** as mesmas boas práticas definidas no comando `/implementar`:
- TDD: escreva testes primeiro (RED), implemente, veja passar (GREEN)
- Convenções do projeto: `@AGENTS.md`, `.claude/rules/`
- Validação de segurança (nunca confiar no cliente, userId do JWT, etc.)
- Tipagem TypeScript strict

## Passo 2 — Delegar correção

Determine qual agent deve executar a correção com base nos arquivos afetados:

| Arquivos afetados | Agent |
|-------------------|-------|
| `src/app/api/auth/*`, `src/lib/auth.ts`, `src/lib/prisma.ts` | backend-auth |
| `src/app/api/leads/*`, `src/app/api/vendedores/*` | backend-crud |
| `src/app/api/metrics/*`, `src/app/api/relatorios/*` | backend-metrics |
| `src/components/kanban/*`, `src/hooks/use-leads*`, `src/app/board/*` | frontend-kanban |
| `src/components/layout/*`, `src/hooks/use-auth*`, `src/app/login/*` | frontend-auth |
| `src/components/dashboard/*`, `src/hooks/use-metrics*`, `src/app/dashboard/*` | frontend-admin |
| `src/constants/*`, `src/types/*`, `src/components/layout/*`, `src/app/page.tsx` | frontend-core |
| `prisma/*`, `next.config.ts`, package.json, config files | infra |
| Múltiplas camadas | Execute sequentially, um agent por vez |

Use a skill `api-route-pattern` se for modificar API Routes.

## Passo 3 — Executar TDD
1. Modifique os arquivos necessários seguindo a solução proposta
2. Escreva ou atualize testes em `__tests__/` que comprovem a correção
3. Execute `!npm test -- --silent 2>&1` — deve passar (GREEN)
4. Execute `!npm run build 2>&1` — deve compilar

## Passo 4 — Validar correção
- Verifique se a causa raiz foi de fato eliminada (releia o código alterado)
- Verifique se nenhum teste existente quebrou
- Verifique se as convenções de segurança foram mantidas

## Passo 5 — Executar code review
Execute `/review` para revisar as alterações.

## Passo 6 — Gerar relatório final
Crie o diretório `docs/bugs/` se não existir.

Salve o relatório final em `docs/bugs/correcao-<data-hora>.md` com o formato:

```markdown
# Correção de Bug

**Data:** <data>
**Referência:** <caminho do relatório de análise>

## Problema
<descrição>

## Causa Raiz
<descrição técnica>

## Solução Implementada
### Arquivos modificados
- `arquivo` — o que foi alterado

### Testes
- `arquivo_de_teste` — o que foi testado

### Decisões técnicas
<decisões relevantes>

## Validação
- [ ] `npm test` passa
- [ ] `npm run build` compila
- [ ] Causa raiz eliminada
- [ ] Code review aprovado

## Status
CORRIGIDO
```
