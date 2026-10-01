---
name: design-system
description: >-
  Tokens de design e identidade visual extraídos do site codemed.com.br. Use
  esta skill para aplicar a identidade visual Codemed em componentes frontend:
  paleta de cores, tipografia Khand + Dosis + Lexend, border-radius, cards,
  botões e layouts.
---

# Skill: Design System — Codemed

Identidade visual extraída do site [codemed.com.br](https://newsite.codemad.com.br.codemed.com.br/wp).

## Paleta de Cores

```css
:root {
  /* Primárias */
  --color-navy: #011126;
  --color-navy-light: #040944;
  --color-navy-dark: #050339;
  --color-blue-dark: #082744;
  --color-blue-secondary: #021936;

  /* Accent */
  --color-green: #afdc3b;
  --color-green-hover: #C6ED44;
  --color-green-dark: #91BD52;
  --color-green-toggle: #afdc39;

  /* Superfícies */
  --color-surface: #ffffff;
  --color-surface-card: #ffffff;
  --color-border-light: #e8e8e8;
  --color-border-medium: #D6D5D5;

  /* Texto */
  --color-text-primary: #0C0D0E;
  --color-text-on-dark: #FFFFFF;
  --color-text-muted: #9DA5AE;
  --color-text-nav: #FFFFFF;

  /* Form */
  --color-input-border: #D6D5D5;
  --color-input-focus: #706F6F;
  --color-input-placeholder: #9DA5AE;

  /* Estados */
  --color-success-bg: #D4E9D6;
  --color-success-text: #2F532E;
  --color-error-bg: #ffdede;
  --color-error-text: #870000;

  /* Gradientes */
  --gradient-hero: radial-gradient(at center center, #090232 0%, #000000 100%);
}
```

## Tipografia

### Fontes

| Nome | Uso | Variações |
|------|-----|-----------|
| **Khand** | Títulos, display, navegação | Bold (700), SemiBold (600), Medium (500), Regular (400) |
| **Dosis** | Corpo de texto, parágrafos | Variable weight (usar 400 para corpo) |
| **Lexend** | Alternativa/textos secundários | 100–900 (Google Fonts) |

### Font-face (Khand + Dosis — self-hosted)

```css
@font-face { font-family: 'khand-bold'; font-weight: 700; src: url('/fonts/Khand-Bold.ttf') format('truetype'); }
@font-face { font-family: 'khand-semibold'; font-weight: 600; src: url('/fonts/Khand-SemiBold.ttf') format('truetype'); }
@font-face { font-family: 'khand-medium'; font-weight: 500; src: url('/fonts/Khand-Medium.ttf') format('truetype'); }
@font-face { font-family: 'khand-regular'; src: url('/fonts/Khand-Regular.ttf') format('truetype'); }
@font-face { font-family: 'dosis-variablefont_wght'; src: url('/fonts/Dosis-VariableFont_wght.ttf') format('truetype'); }
```

### Escala Tipográfica

| Elemento | Font | Size | Weight | Line-Height | Tracking |
|----------|------|------|--------|-------------|----------|
| Hero heading | Khand Bold | 59px (→42px/→28px) | 700 | 58px (→45px/→1.1em) | — |
| Section heading | Khand Bold | 34px | 700 | — | — |
| Card title | Khand Bold | 24px | 700 | 1.25em | -0.02em |
| Subheading | Khand Bold | 22px | — | — | — |
| Body text | Dosis | 22px | 400 | — | — |
| Testimonial text | Dosis | — | — | — | — |
| Testimonial name | Khand Bold | — | — | — | — |
| Nav menu (desktop) | Khand Bold | 13px (→12px @1440) | — | — | — |
| Nav submenu | Khand Bold | 14px | 500 | 15px | 0.9px |
| Description text | Lexend | 18px (→16px mobile) | — | 25px | -0.3px |
| Submenu | Khand Bold | 14px | 500 | 15px | 0.9px |

### Responsivo

- **Desktop (≥1440px)**: Hero 59px, nav 12px, containers centralizados ~1159–1363px
- **Tablet (≤1024px)**: Padding 1em nas laterais
- **Mobile (≤767px)**: Hero 28px, títulos 25px, grid 1 coluna

## Layout & Cards

### Container padrão
- Max-width: `1363px` (desktop), centralizado
- Padding lateral: `52px 30px` (header), `1em` (tablet/mobile)

### Cards
- `border-radius: 12px`
- `box-shadow: 0px 4px 30px 0px rgba(0, 0, 0, 0.06)`
- Background: `#ffffff` (ou `var(--color-surface)`)
- Padding interno: `0 50px 27px 50px`
- Ícone decorativo SVG opcional no canto superior direito

### Header/Navbar
- Background: `#011126` (navy escuro)
- Posição: fixed, top 0, z-index: 12
- `backdrop-filter: blur(5px)`
- Padding: `13px 52px 13px 30px` (desktop) → `13px 15px` (1180px) → `1em` (mobile)
- Menu gap: `10px` entre itens
- Menu item padding: `7px` horizontal, `15px` vertical
- Submenu margin-top: `34px`

### Botões
- CTA primary: background `#3858e9`, color `#ffffff`, padding `15px 30px`
- Hover: background `#000000`, color `#ffffff`
- Ícone: `15px`, margem `10px`

### Seções
- Hero: min-height `879px` (→685px/→425px), grid 2 colunas (1 col mobile)
- Gap entre cards/sections: `80px 30px` (row/column)
- Testimonials: carrossel com `50%` largura, setas `20px` cor `#021936`

## Elementos de Formulário (Elementor base)

- Input height: `36px`, font-size `12px`
- Border-radius: `0px`
- Label: `14px`
- Checkbox: `1.15em`, border-radius `0px`
- Submit button: padding `10px 28px 10px 30px`, background `#000`
- Success: bg `#D4E9D6`, text `#2F532E`
- Error: bg `#ffdede`, text `#870000`

## Utilização

Carregue esta skill com o comando `skill design-system` sempre que for criar componentes que devem seguir a identidade visual Codemed. Use `frontend-design` para as diretrizes estéticas de implementação (animações, composição, diferenciação).

```tool_call
skill name=design-system
```
