---
description: Revisa o código contra SPEC.md e PLAN.md, classifica em BLOQUEANTE, IMPORTANTE, SUGESTÃO
agent: code-reviewer
---

Leia os documentos de referência:
- @SPEC.md
- @PLAN.md
- @AGENTS.md

Analise todo o código-fonte implementado em `src/`, `prisma/`, `__tests__/` e arquivos de configuração na raiz.

Compare o que foi implementado contra o que está especificado. Verifique:

1. Se todos os endpoints de API listados no PLAN.md existem e funcionam
2. Se os testes cobrem os cenários críticos
3. Se as convenções do projeto foram seguidas
4. Se há violações de segurança (userId vindo do body, senha exposta em responses, etc.)
5. Se `npm test` passa sem falhas: !`npm test -- --silent 2>&1`
6. Se `npm run build` compila sem erros: !`npm run build 2>&1`
7. Se não há secrets vazados no repositório: !`git log --all --diff-filter=A --follow -p -- '.env' 2>&1 | head -20`

Produza a saída no formato:
## 🔴 BLOQUEANTE
- [arquivo:linha] descrição do problema

## 🟡 IMPORTANTE
- [arquivo:linha] descrição do problema

## 🔵 SUGESTÃO
- [arquivo:linha] descrição da melhoria

Regras:
- BLOQUEANTE = funcionalidade quebrada, segurança comprometida, spec não implementada, build/test falhando
- IMPORTANTE = convenção violada, falta de teste, validação insuficiente
- SUGESTÃO = melhoria de legibilidade, boas práticas sem impacto funcional
- Se encontrar o mesmo padrão em múltiplos arquivos, aponte uma vez e generalize
- Se `npm test` ou `npm run build` falharem, isso é BLOQUEANTE
