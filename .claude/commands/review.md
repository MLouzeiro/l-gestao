---
description: Revisa o código contra SPEC.md e PLAN.md, classifica em BLOQUEANTE, IMPORTANTE, SUGESTÃO
---

Chame o @code-reviewer com as seguintes instruções:

Leia SPEC.md e PLAN.md na raiz do projeto.

Analise todo o código-fonte implementado em `src/`, `prisma/`, `__tests__/` e arquivos de configuração na raiz.

Compare o que foi implementado contra o que está especificado. Verifique:

1. Se todos os endpoints de API listados no PLAN.md existem e funcionam
2. Se os testes cobrem os cenários críticos
3. Se as convenções do projeto (AGENTS.md) foram seguidas
4. Se há violações de segurança (userId vindo do body, senha exposta, etc.)
5. Execute `npm test` e veja se passa
6. Execute `npm run build` e veja se compila

Produza a saída no formato:
## 🔴 BLOQUEANTE
## 🟡 IMPORTANTE
## 🔵 SUGESTÃO
