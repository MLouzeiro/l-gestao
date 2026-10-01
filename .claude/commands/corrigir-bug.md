---
description: Recebe relatório de análise de bug, orquestra correção e produz relatório final em docs/bugs/
---

Você recebeu o relatório de análise para correção: "{input}"

Leia o arquivo de análise informado. Extraia a causa raiz, localização (arquivo:linha), solução proposta e gravidade.

## Passo 1 — Preparar ambiente
Siga rigorosamente as mesmas boas práticas do `/implementar`: TDD (RED→GREEN), convenções do projeto, segurança, tipagem.

## Passo 2 — Delegar correção
Determine qual agent de `.claude/agents/` deve executar a correção com base nos arquivos afetados. Para múltiplas camadas, execute sequencialmente.

## Passo 3 — Executar TDD
Modifique os arquivos, escreva testes, execute `npm test` (GREEN) e `npm run build`.

## Passo 4 — Chamar code review
Chame o @code-reviewer para revisar as alterações.

## Passo 5 — Gerar relatório final
Crie `docs/bugs/correcao-<data-hora>.md` com problema, causa raiz, solução implementada, arquivos modificados, testes e status CORRIGIDO.
