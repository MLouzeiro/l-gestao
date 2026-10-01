---
description: Recebe descrição de erro, analisa código, produz relatório de causa raiz e pergunta se pode corrigir
argument-hint: <descrição do erro>
---

Você recebeu a seguinte descrição de erro para análise: "$ARGUMENTS"

## Passo 1 — Compreender o erro
Analise a descrição fornecida. Identifique:
- Qual funcionalidade está afetada
- Em qual camada o erro ocorre (API, banco, frontend, build/test)
- Palavras-chave para busca no código

## Passo 2 — Investigação profunda no código
1. Busque por arquivos relacionados ao erro usando padrões de nome e conteúdo:
   - `!rg -r -i "<termo>" src/ --type-add 'ts:*.{ts,tsx}' -t ts 2>&1`
   - Use `@` para ler arquivos suspeitos
2. Leia os arquivos mais relevantes ao redor do erro
3. Verifique testes relacionados em `__tests__/`
4. Execute `!npm test -- --silent 2>&1` para verificar o estado atual
5. Se aplicável, verifique logs de build: `!npm run build 2>&1`

## Passo 3 — Mapear causa raiz
Documente:
- **Sintoma:** o que o usuário vê
- **Localização:** arquivo:linha exatos
- **Causa raiz:** o que no código está produzindo o comportamento errado
- **Impacto:** quais funcionalidades/usuários são afetados
- **Gravidade:** BLOQUEANTE | IMPORTANTE | SUGESTÃO

## Passo 4 — Propor solução
Descreva a correção necessária:
- Arquivos a modificar
- Abordagem técnica
- Possíveis efeitos colaterais
- Testes necessários

## Passo 5 — Salvar relatório parcial
Crie o diretório `docs/bugs/` se não existir.

Salve o relatório da análise em `docs/bugs/analise-<data-hora>.md` com o formato:

```markdown
# Análise de Bug

**Data:** <data>
**Descrição:** <recebida do usuário>

## Sintoma
...

## Localização
`arquivo:linha`

## Causa Raiz
...

## Impacto
...

## Gravidade
BLOQUEANTE | IMPORTANTE | SUGESTÃO

## Solução Proposta
- Arquivos: ...
- Abordagem: ...
- Testes: ...

## Status
AGUARDANDO AUTORIZAÇÃO
```

## Passo 6 — Questionar usuário
Apresente o relatório ao usuário de forma clara e objetiva:

```
## Análise concluída

### Problema: <sintoma resumido>
### Local: `arquivo:linha`
### Causa: <causa raiz resumida>
### Solução: <abordagem resumida>

Deseja que eu execute automaticamente o `/corrigir-bug` com este relatório?
```

Então aguarde a resposta do usuário.
- Se **sim:** execute o comando `/corrigir-bug docs/bugs/analise-<data-hora>.md`
- Se **não:** informe que o relatório está salvo em `docs/bugs/analise-<data-hora>.md` para referência futura
