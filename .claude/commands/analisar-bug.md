---
description: Recebe descrição de erro, analisa código, produz relatório de causa raiz e pergunta se pode corrigir
---

Você recebeu a seguinte descrição de erro para análise: "{input}"

## Passo 1 — Compreender o erro
Analise a descrição fornecida. Identifique qual funcionalidade está afetada, em qual camada o erro ocorre (API, banco, frontend, build/test) e palavras-chave para busca no código.

## Passo 2 — Investigação profunda no código
Busque por arquivos relacionados ao erro, leia os arquivos suspeitos, verifique testes relacionados em `__tests__/` e execute `npm test` e `npm run build` para verificar o estado atual.

## Passo 3 — Mapear causa raiz
Documente o sintoma, localização (arquivo:linha), causa raiz, impacto e gravidade (BLOQUEANTE | IMPORTANTE | SUGESTÃO).

## Passo 4 — Propor solução
Descreva a correção necessária: arquivos a modificar, abordagem técnica, possíveis efeitos colaterais e testes necessários.

## Passo 5 — Salvar relatório parcial
Crie `docs/bugs/analise-<data-hora>.md` com o formato:

```markdown
# Análise de Bug
**Data:** <data>
**Descrição:** <recebida>
## Sintoma
...
## Localização
`arquivo:linha`
## Causa Raiz
...
## Impacto
...
## Gravidade
...
## Solução Proposta
...
## Status
AGUARDANDO AUTORIZAÇÃO
```

## Passo 6 — Questionar usuário
Apresente o relatório ao usuário e pergunte se deseja executar automaticamente o `/corrigir-bug` com este relatório. Se sim, chame o @code-reviewer com instruções para orquestrar a correção seguindo TDD e boas práticas. Se não, informe que o relatório está salvo em `docs/bugs/`.
