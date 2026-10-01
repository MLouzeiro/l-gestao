---
name: frontend-design
description: >-
  Cria interfaces frontend de alto nível de design, com estética marcante e
  código de produção. Use esta skill quando o usuário pedir para construir
  componentes, páginas ou aplicações frontend.
license: Complete terms in LICENSE.txt
---

# Skill: Frontend Design

Cria interfaces frontend com direção estética ousada, evitando o visual genérico de "AI slop". Gera código funcional com atenção excepcional a detalhes estéticos e escolhas criativas.

O usuário fornece requisitos de frontend: um componente, página, aplicação ou interface para construir. Pode incluir contexto sobre propósito, público ou restrições técnicas.

## Design Thinking

Antes de codificar, entenda o contexto e escolha uma **direção estética** clara:

- **Propósito**: Qual problema esta interface resolve? Quem usa?
- **Tom**: Escolha um extremo: brutalmente minimalista, caos maximalista, retro-futurista, orgânico/natural, luxuoso/refinado, lúdico/brinquedo, editorial/revista, brutalista/cru, art déco/geométrico, suave/pastel, industrial/utilitário, etc. Use estes como inspiração mas crie algo fiel à direção estética.
- **Restrições**: Requisitos técnicos (framework, performance, acessibilidade).
- **Diferenciação**: O que torna isso INESQUECÍVEL? Qual a única coisa que alguém vai lembrar?

**CRÍTICO**: Escolha uma direção conceitual clara e execute com precisão. Maximalismo ousado e minimalismo refinado funcionam — o segredo é intencionalidade, não intensidade.

Depois implemente código funcional (React/Next.js, CSS/Tailwind) que seja:
- De nível de produção e funcional
- Visualmente marcante e memorável
- Coeso com um ponto de vista estético claro
- Meticulosamente refinado em cada detalhe

## Diretrizes de Estética Frontend

Foco em:

- **Tipografia**: Escolha fontes bonitas, únicas e interessantes. Evite fontes genéricas como Inter, Roboto, Arial e fontes de sistema; prefira escolhas distintas que elevem a estética. Combine uma fonte de destaque com uma fonte de corpo refinada.
- **Cor & Tema**: Comprometa-se com uma estética coesa. Use variáveis CSS para consistência. Cores dominantes com acentos marcantes superam paletas tímidas e uniformemente distribuídas.
- **Movimento**: Use animações para efeitos e micro-interações. Priorize soluções CSS-only quando possível. Use a biblioteca Motion (framer-motion) para React quando disponível. Foco em momentos de alto impacto: um carregamento de página bem orquestrado com revelações escalonadas (`animation-delay`) cria mais encanto do que micro-interações dispersas. Use scroll-triggering e estados de hover que surpreendem.
- **Composição Espacial**: Layouts inesperados. Assimetria. Sobreposição. Fluxo diagonal. Elementos que quebram a grade. Espaço negativo generoso OU densidade controlada.
- **Fundos & Detalhes Visuais**: Crie atmosfera e profundidade em vez de usar cores sólidas padrão. Adicione efeitos contextuais e texturas que combinem com a estética geral. Aplique formas criativas como gradient meshes, texturas de ruído, padrões geométricos, transparências em camadas, sombras dramáticas, bordas decorativas, cursores personalizados e overlays de granulação.

NUNCA use estética genérica de IA como famílias de fonte excessivamente usadas (Inter, Roboto, Arial, fontes de sistema), esquemas de cores clichê (particularmente gradientes roxos em fundos brancos), layouts previsíveis e padrões de componente genéricos, ou design padronizado que carece de caráter contextual.

Interprete criativamente e faça escolhas inesperadas que pareçam genuinamente projetadas para o contexto. Nenhum design deve ser igual. Varie entre temas claro e escuro, fontes diferentes, estéticas diferentes. NUNCA convirja para escolhas comuns (Space Grotesk, por exemplo) entre gerações.

**IMPORTANTE**: Combine a complexidade da implementação com a visão estética. Designs maximalistas precisam de código elaborado com animações e efeitos extensivos. Designs minimalistas ou refinados precisam de contenção, precisão e atenção cuidadosa a espaçamento, tipografia e detalhes sutis. Elegância vem de executar bem a visão.

## Stack do Projeto

Este projeto usa:
- **Framework**: Next.js (App Router)
- **UI Library**: React via Next.js
- **Estilização**: Tailwind CSS + shadcn/ui
- **Animação**: framer-motion (Motion library) — disponível no projeto
- **Ícones**: lucide-react — disponível no projeto
- **Fonte**: Configurável via `next/font` em `src/app/layout.tsx`

### Fontes disponíveis (Google Fonts via next/font)

Sempre configurar fontes no layout raiz (`src/app/layout.tsx`) usando `next/font/google`. Exemplo:

```typescript
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";

const display = Playfair_Display({ subsets: ["latin"], variable: "--font-display" });
const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body" });
```

Usar `--font-display` para títulos e `--font-body` para texto corrido via Tailwind.

### Paleta de cores

Usar variáveis CSS do Tailwind (`tailwind.config.ts`) e/ou CSS custom properties no `:root` do globals.css. Exemplo:

```css
:root {
  --color-primary: #1a1a2e;
  --color-accent: #e94560;
  --color-surface: #f8f9fa;
}
```

## Quando NÃO usar esta skill

- **API Routes** — usar a skill `api-route-pattern`
- **Testes** (`__tests__/`) — testes não precisam de design
- **Lógica de backend** (Prisma queries, auth) — fora do escopo
- **Configuração de infraestrutura** — usar `infra`
