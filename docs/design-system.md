# Nocturne Design System

**Version 1.0 · October 2026**

Nocturne is a visual language for calm, confident products that handle serious things: money, data and infrastructure. It uses a near-black ground, a single cobalt light source, white pill-shaped actions, and glass only where something sits behind it.

**The feel in three words: calm, exact, trusted.**

---

## Contents

1. [Design principles](#1-design-principles)
2. [Color](#2-color)
3. [Typography](#3-typography)
4. [Spacing & layout](#4-spacing--layout)
5. [Shape & depth](#5-shape--depth)
6. [Components](#6-components)
7. [CSS custom properties](#7-css-custom-properties)
8. [Open proposals (not yet adopted)](#8-open-proposals-not-yet-adopted)

---

## 1. Design principles

Seven rules that keep every screen consistent.

| # | Principle | Rule |
|---|---|---|
| P1 | **Dark ground, light as signal** | The page is night (`#07080F`). Pure white is spent only on what should be read or clicked first: the headline and the primary pill. |
| P2 | **One light source per view** | A single cobalt radial glow sits behind the hero object. Everything else is flat. Depth comes from that light, not from many shadows. |
| P3 | **Pills act, rectangles hold** | Anything you press (buttons, nav, badges, filters) is a full pill. Anything that contains content is a rounded rectangle, 16–28px. |
| P4 | **Two-tone headlines** | State the claim in white and finish the thought in muted grey on the next line. Use tight negative tracking and never gradient text. |
| P5 | **Glass is a layer, not a look** | Translucent, blurred surfaces only where something real sits behind them: floating chips over a hero, modals, sticky nav. |
| P6 | **Generous air, low density** | Sections breathe at 128px, and body copy stops at 560px wide. Keep to one idea per band. If it feels empty, it is probably right. |
| P7 | **Precise, plain tone** | Proof over adjectives: exact figures, short labels, sentence case. Set numbers large with a small caption under them. |

### Don'ts

1. **No competing lights.** Never put two white primary buttons, two glows, or a cobalt fill behind a large area in one view. The signal only works if it is singular.
2. **No new hues or rainbow gradients.** Color comes from cobalt, platinum, violet and the neutrals. Semantic colors appear only to report status, never as decoration.
3. **No hard edges or heavy chrome.** No square buttons, borders of 2px or more, opaque grey cards, or light-mode drop shadows. Edges are 1px white hairlines at 8–16% opacity.

---

## 2. Color

As a rough budget, about 85% of any screen is background and neutrals, 10% is white text and actions, and 5% is brand color. All contrast ratios below are measured against the page background `#07080F` unless stated otherwise.

### Brand

#### Primary: Cobalt (`color.primary.*`)
Used for brand moments: the hero object, focus rings, selected states, progress, check icons, and the filled confirm button inside the product. **Use 300 for brand text on dark.**

| Token | Hex | Notes |
|---|---|---|
| `color.primary.300` | `#8C98FF` | Links and brand text on dark (7.66:1) |
| `color.primary.400` | `#6474FA` | Focus border on inputs |
| `color.primary.500` | `#4255F5` | **Base.** Fills and icons only on dark (3.66:1) |
| `color.primary.600` | `#2F3FD6` | Gradient mid-stop; white text 7.49:1 |
| `color.primary.700` | `#1E2690` | Gradient end-stop |

#### Secondary: Platinum (`color.secondary.*`)
The cool metallic counterpart to cobalt. Used for secondary product objects, illustration, avatars, chart series 2, and subtle highlights on dark cards.

| Token | Hex |
|---|---|
| `color.secondary.100` | `#ECEEF3` |
| `color.secondary.200` | `#DADDE6` |
| `color.secondary.300` | `#C7CBD6` (**base**) |
| `color.secondary.400` | `#9AA0B2` |
| `color.secondary.500` | `#6E7488` |

#### Accent: Aurora (`color.accent.*`)
A rare spark only: the logo dot, new-feature badges, the second stop of the hero glow, a chart highlight. **Never more than one accent element per viewport.**

| Token | Hex |
|---|---|
| `color.accent.200` | `#DDD3FE` |
| `color.accent.300` | `#C4B2FC` |
| `color.accent.400` | `#A78BFA` (**base**) |
| `color.accent.500` | `#8B67F0` |
| `color.accent.600` | `#6D48D4` |

### Neutral scale (`color.neutral.*`)
Cool-tinted slate, hue 230°.

| Token | Hex | Use |
|---|---|---|
| `neutral.50` | `#F5F6FA` | Primary text, primary button fill |
| `neutral.100` | `#E8EAF2` | Pressed primary button, nav labels |
| `neutral.200` | `#CDD1E0` | Emphasised secondary text |
| `neutral.300` | `#A9AEC4` | Secondary text, body copy |
| `neutral.400` | `#7F85A0` | Muted text, captions, placeholders |
| `neutral.500` | `#5C627D` | Disabled text, icons |
| `neutral.600` | `#424760` | Strong dividers, disabled ghost button |
| `neutral.700` | `#2D3148` | Opaque borders, scrollbars |
| `neutral.800` | `#1A1D2E` | Surface 2, tooltips |
| `neutral.900` | `#0E1020` | Surface 1, opaque cards |
| `neutral.950` | `#07080F` | Page background |

### Background & surfaces

| Token | Value | Use |
|---|---|---|
| `bg.canvas` | `#07080F` | Page background everywhere |
| `bg.glow` | `radial-gradient(60% 55% at 65% 40%, rgba(66,85,245,0.55), transparent 70%)` | Ambient light behind the hero object. **One per view.** |
| `surface.1` | `#0E1020` | Opaque cards, sidebars, tables |
| `surface.2` | `#1A1D2E` | Raised items inside surface 1, menus, tooltips |
| `surface.glass` | `rgba(255,255,255,0.04)` + `backdrop-filter: blur(20px)` | Translucent panels over imagery or glow: nav, stat bar, floating chips |
| `surface.overlay` | `rgba(18,20,42,0.85)` + `backdrop-filter: blur(24px)` | Modals, popovers, sheets |
| `surface.scrim` | `rgba(5,6,11,0.72)` + `backdrop-filter: blur(8px)` | Behind modals |

### Text

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `text.primary` | `#F5F6FA` | 18.5:1 | Headlines, body emphasis, button labels on dark |
| `text.secondary` | `#A9AEC4` | 9.1:1 | Body copy, descriptions, nav items at rest |
| `text.muted` | `#7F85A0` | 5.5:1 | Captions, metadata, placeholders, headline second line |
| `text.disabled` | `#5C627D` | 3.3:1 ⚠️ | Disabled labels only. Never for readable content. |
| `text.brand` | `#8C98FF` | 7.7:1 | Links, eyebrows, inline brand emphasis |
| `text.inverse` | `#07080F` | 18.5:1 on `neutral.50` | Labels on white primary buttons and semantic fills |

### Borders

| Token | Value | Use |
|---|---|---|
| `border.subtle` | `1px solid rgba(255,255,255,0.08)` | Dividers inside cards, table rows |
| `border.default` | `1px solid rgba(255,255,255,0.12)` | Cards, inputs, nav pill, glass panels |
| `border.strong` | `1px solid rgba(255,255,255,0.20)` | Hover on inputs and secondary buttons |
| `border.focus` | `2px solid #6474FA` | Focused inputs |
| `ring.focus` | `0 0 0 2px #07080F, 0 0 0 4px #8C98FF` | Focus ring on every interactive element (2px ring, 2px offset) |

### Semantic

All four are tuned for dark backgrounds. **Solid fills take `#07080F` labels, never white.**

| Token | Hex | As text | Tint (fill) | Border | Use |
|---|---|---|---|---|---|
| `success` | `#3DD68C` | 10.7:1 | `rgba(61,214,140,0.12)` | `rgba(61,214,140,0.28)` | Completed payments, verified, saved |
| `warning` | `#F5B544` | 11.0:1 | `rgba(245,181,68,0.12)` | `rgba(245,181,68,0.28)` | Pending, limits near, needs review |
| `error` | `#F26D6D` | 6.8:1 | `rgba(242,109,109,0.12)` | `rgba(242,109,109,0.28)` | Failed, declined, invalid input, destructive |
| `info` | `#5AA9F5` | 8.0:1 | `rgba(90,169,245,0.12)` | `rgba(90,169,245,0.28)` | Neutral notices, tips, scheduled |

### Contrast concerns (WCAG 2.2)

- **Cobalt 500 `#4255F5` is not a text color on dark.** At 3.66:1 on `#07080F` it passes for UI shapes and icons (3:1) but fails body text. Use Cobalt 300 `#8C98FF` (7.66:1) for links and brand text.
- **White on cobalt is fine.** `#FFFFFF` on Cobalt 500 is 5.46:1 and on Cobalt 600 is 7.49:1, so the brand card and a filled cobalt button can carry white labels.
- **The lightest readable text is Neutral 400 `#7F85A0` (5.49:1).** Neutral 500 is for disabled text only (3.33:1, which WCAG exempts for disabled elements).
- **Semantic fills need dark labels.** White text on success, warning, error or info falls to 1.8–2.9:1. Label solid fills with `#07080F`.
- **Glass lowers contrast unpredictably.** Check text on translucent surfaces against the brightest thing behind it, usually the glow. Keep at least a 0.04 white fill plus 20px blur.
- **Hairlines are decorative.** Borders at 8–12% white fall below 3:1, so never let a border alone mark an input or a selected state. Pair it with a fill, a focus ring or text.

---

## 3. Typography

### Font families
Both are free on Google Fonts under the OFL license.

| Role | Family | Weights | Stack |
|---|---|---|---|
| UI, display & body | **Geist** | 400 · 500 · 600 | `'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| Data, labels, code | **Geist Mono** | 400 · 500 | `'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace` |

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Use `font-feature-settings: 'tnum' 1` (or `font-variant-numeric: tabular-nums`) on figures. Use Geist Mono for overlines, card numbers, IDs, code and token names.

### Type scale

| Token | Size | Line height | Weight | Letter spacing | Use when |
|---|---|---|---|---|---|
| `type.display-xl` | 72px | 1.02 | 600 | -0.035em | Hero headline only. One per page. |
| `type.display` | 56px | 1.05 | 600 | -0.03em | Section openers on marketing pages, board titles |
| `type.h1` | 44px | 1.1 | 600 | -0.025em | Page title inside the product. One per screen. |
| `type.h2` | 32px | 1.15 | 600 | -0.02em | Section headings, modal hero titles |
| `type.h3` | 24px | 1.25 | 600 | -0.015em | Card titles, modal titles, sub-sections |
| `type.h4` | 18px | 1.35 | 600 | -0.01em | Small card titles, list group headings |
| `type.stat` | 32px | 1 | 500 | -0.02em | Key figures with tabular numerals and a caption beneath |
| `type.body-l` | 18px | 1.55 | 400 | -0.005em | Hero lead paragraph, intro copy (`text.secondary`) |
| `type.body` | 16px | 1.55 | 400 | 0 | Default reading text in the product and docs |
| `type.body-s` | 14px | 1.5 | 400 | 0 | Card descriptions, table cells, dense lists |
| `type.label` | 14px | 1 | 500 | 0 | Buttons, nav items, tabs. Form labels use 13px. |
| `type.caption` | 12px | 1.4 | 400 | 0.01em | Captions under stats, helper text, timestamps (`text.muted`) |
| `type.overline` | 11px | 1.2 | 500 | 0.08em | **Geist Mono, uppercase.** Above section titles, table headers (`text.brand`) |

### Rules

- **Responsive steps.** Below 768px: Display XL 72→44, Display 56→40, H1 44→32, H2 32→26, H3 24→20. Body sizes never shrink. Use `clamp()`:
  - Display XL: `clamp(44px, 5vw + 1rem, 72px)`
  - Display: `clamp(40px, 4vw + 1rem, 56px)`
  - H2: `clamp(26px, 2vw + 1rem, 32px)`
- **Pairing.** Use one display level per section. Gap from headline to body is 24px; from overline to headline it is 16px. Maximum line length is 560px for body text and 760px for headlines. Use sentence case everywhere except Overline.
- **Weights.** 600 for headings only, 500 for labels, buttons and numerals, 400 for reading. Never 700 or heavier: on dark backgrounds, heavy weights bloom and look shouted.

---

## 4. Spacing & layout

### Spacing scale (4px base)

| Token | Value | Typical use |
|---|---|---|
| `space.1` | 4px | Icon-to-label nudge, badge dot gap |
| `space.2` | 8px | Inline gaps, chip vertical padding |
| `space.3` | 12px | Button groups, icon + text |
| `space.4` | 16px | Input horizontal padding, small grid gap |
| `space.5` | 20px | Compact card padding |
| `space.6` | 24px | Card padding, grid gutter |
| `space.8` | 32px | Modal padding, block gaps |
| `space.10` | 40px | Headline to CTA row |
| `space.12` | 48px | Between content groups |
| `space.16` | 64px | Section padding (mobile) |
| `space.20` | 80px | Page margin (desktop) |
| `space.24` | 96px | Section padding (tablet) |
| `space.32` | 128px | Section padding (desktop) |

### Breakpoints & grid

| Name | Min width | Columns | Gutter | Page margin | Section padding (vertical) |
|---|---|---|---|---|---|
| Mobile | 0 | 4 | 16px | 16px | 64px |
| Tablet | 768px | 8 | 20px | 32px | 96px |
| Desktop | 1024px | 12 | 24px | 48px | 128px |
| Wide | 1440px | 12 | 24px | 80px | 128px |

### Containers

| Token | Max width | Use |
|---|---|---|
| `container.wide` | 1360px | Nav, stat bars, full-bleed rows |
| `container.default` | 1200px | All page content |
| `container.narrow` | 720px | Articles, forms, legal |
| `measure.body` | 560px | Maximum line length of body copy |

### Layout rules

- **Hero:** copy spans 5 columns, one column is left empty, and the hero object spans 6 (columns 7–12). Hero top padding is 160px on desktop and 96px on mobile.
- **Card grids** use 3 or 4 equal columns and stack to 1 column below 768px.
- **Stat bars** use 4 equal cells (3 columns each on a 12-column grid).

---

## 5. Shape & depth

### Border radius

| Token | Value | Use |
|---|---|---|
| `radius.xs` | 6px | Checkboxes, tiny tags, code |
| `radius.sm` | 10px | Menu items, swatches, tooltips |
| `radius.md` | 12px | Inputs, selects, small tiles |
| `radius.lg` | 16px | Floating chips, toasts, list cards |
| `radius.xl` | 20px | Cards, glass panels, stat bars |
| `radius.2xl` | 28px | Modals, hero objects, brand cards |
| `radius.pill` | 999px | Buttons, nav, badges, avatars |

### Border widths

| Token | Value | Use |
|---|---|---|
| `border.1` | 1px | All hairlines, cards, inputs |
| `border.2` | 2px | Focus rings, active tab bar |
| `divider.fade` | 1px tall, `linear-gradient(90deg, transparent, rgba(255,255,255,0.20), transparent)` | Section rules |

Never use borders thicker than 2px.

### Elevation

| Token | `box-shadow` | Use |
|---|---|---|
| `e0` | `none` | Flat: page sections, inline content |
| `e1` | `inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.40)` | Cards at rest, inputs |
| `e2` | `inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -8px rgba(0,0,0,0.60)` | Hovered cards, floating chips |
| `e3` | `inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 48px -12px rgba(0,0,0,0.70)` | Menus, popovers, sticky nav |
| `e4` | `0 0 0 1px rgba(255,255,255,0.08), 0 40px 80px -20px rgba(0,0,0,0.80)` | Modals, sheets |
| `glow.brand` | `0 24px 60px -16px rgba(66,85,245,0.55)` | Under cobalt brand objects |

### Gradients

| Token | Value | Use |
|---|---|---|
| `gradient.glow` | `radial-gradient(60% 55% at 65% 40%, rgba(66,85,245,0.55), transparent 70%)`, with an optional aurora stop `radial-gradient(30% 30% at 40% 70%, rgba(167,139,250,0.22), transparent 70%)` | Behind the hero object only |
| `gradient.cobalt` | `linear-gradient(135deg, #5468F5 0%, #2F3FD6 55%, #1E2690 100%)` + `inset 0 1px 0 rgba(255,255,255,0.25)` | Brand objects: card art, feature tile, app icon |
| `gradient.platinum` | `linear-gradient(135deg, #ECEEF3 0%, #C7CBD6 50%, #9AA0B2 100%)` + `inset 0 1px 0 rgba(255,255,255,0.7)` | Secondary objects. Text on it uses `#07080F`. |

### Blur

| Token | Value | Use |
|---|---|---|
| `blur.glass` | `backdrop-filter: blur(20px) saturate(140%)`, fill 0.04–0.06 white | Glass panels, floating chips, sticky nav |
| `blur.overlay` | `backdrop-filter: blur(24px)` | Modals, popovers, sheets |
| `blur.scrim` | `backdrop-filter: blur(8px)` | Modal scrim |

Use at most 3 blurred layers per view.

---

## 6. Components

**Global rules**

- All transitions: `160ms cubic-bezier(0.2, 0.8, 0.2, 1)`
- Focus ring everywhere: `0 0 0 2px #07080F, 0 0 0 4px #8C98FF` (2px ring, 2px offset)
- Minimum hit area 40px, or 44px on touch

### Buttons

Shape `radius.pill` · label `type.label` (14px / 500) · 8px gap between label and icon.

**Sizes**

| Size | Height | Horizontal padding | Font size | Use |
|---|---|---|---|---|
| `sm` | 32px | 14px | 13px | Nav, compact toolbars |
| `md` (default) | 40px | 18px | 14px | Everywhere else |
| `lg` | 48px | 22px | 15px | Hero CTAs |

**Primary**: the one main action per view. A white pill on dark.

| State | Background | Text | Border | Other |
|---|---|---|---|---|
| Default | `#F5F6FA` | `#07080F` | none | |
| Hover | `#FFFFFF` | `#07080F` | none | `box-shadow: 0 0 0 4px rgba(255,255,255,0.08), 0 8px 24px -8px rgba(255,255,255,0.35)` |
| Pressed | `#E8EAF2` | `#07080F` | none | `transform: scale(0.98)` |
| Focus | `#F5F6FA` | `#07080F` | none | `ring.focus` |
| Disabled | `rgba(255,255,255,0.12)` | `#5C627D` | none | `cursor: not-allowed` |

**Secondary**: an alternative action beside the primary. An outlined pill.

| State | Background | Text | Border | Other |
|---|---|---|---|---|
| Default | `transparent` | `#F5F6FA` | `1px solid rgba(255,255,255,0.16)` | |
| Hover | `rgba(255,255,255,0.06)` | `#F5F6FA` | `1px solid rgba(255,255,255,0.24)` | |
| Pressed | `rgba(255,255,255,0.10)` | `#F5F6FA` | `1px solid rgba(255,255,255,0.24)` | `transform: scale(0.98)` |
| Focus | `transparent` | `#F5F6FA` | `1px solid rgba(255,255,255,0.16)` | `ring.focus` |
| Disabled | `transparent` | `#5C627D` | `1px solid rgba(255,255,255,0.08)` | `cursor: not-allowed` |

**Ghost**: tertiary actions, toolbars, nav links, "Log in". Text only.

| State | Background | Text | Other |
|---|---|---|---|
| Default | `transparent` | `#A9AEC4` | |
| Hover | `rgba(255,255,255,0.06)` | `#F5F6FA` | |
| Pressed | `rgba(255,255,255,0.10)` | `#F5F6FA` | |
| Focus | `transparent` | `#F5F6FA` | `ring.focus` |
| Disabled | `transparent` | `#424760` | `cursor: not-allowed` |

**Destructive confirm** (in modals): fill `#F26D6D`, label `#07080F`.

### Inputs

Height 44px · horizontal padding 16px · `radius.md` (12px) · text 15px / 400 · label 13px / 500 with an 8px gap below it · helper text 12px / 400.

| State | Fill | Border | Text | Label | Helper | Other |
|---|---|---|---|---|---|---|
| Default | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | `#F5F6FA` | `#A9AEC4` | `#7F85A0` | placeholder `#7F85A0` |
| Hover | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.20)` | `#F5F6FA` | `#A9AEC4` | `#7F85A0` | |
| Focus | `rgba(255,255,255,0.05)` | `#6474FA` | `#F5F6FA` | `#F5F6FA` | `#7F85A0` | `box-shadow: 0 0 0 4px rgba(66,85,245,0.25)` |
| Error | `rgba(242,109,109,0.06)` | `#F26D6D` | `#F5F6FA` | `#A9AEC4` | `#F26D6D` + icon | |
| Disabled | `rgba(255,255,255,0.02)` | `rgba(255,255,255,0.06)` | `#5C627D` | `#5C627D` | `#5C627D` | |

### Cards

| Variant | Padding | Radius | Fill | Border | Shadow | Notes |
|---|---|---|---|---|---|---|
| **Content card** | 24px | 20px | `rgba(255,255,255,0.04)` | `border.default` | `e1` | 12px gap. Icon tile, H4 title, Body S description. |
| Content card: hover | 24px | 20px | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.20)` | `e2` | `transform: translateY(-2px)`; focus uses `ring.focus` on the whole card |
| **Stat bar** | 24px per cell | 20px | `rgba(255,255,255,0.03)` | `border.default` | none | `type.stat` + `type.caption`; `border.subtle` between cells |
| **Floating chip** | 12px 16px | 16px | `rgba(255,255,255,0.06)` + `blur.glass` | `rgba(255,255,255,0.14)` | `e2` | 32px round icon (`#4255F5` fill, white check), 12px gap |
| **Brand object** | | 28px | `gradient.cobalt` | none | `glow.brand` | Hero object only |

**Icon tile** (inside a content card): 40×40px, radius 12px, fill `rgba(66,85,245,0.16)`, border `rgba(100,116,250,0.30)`, 20px stroke icon in `#8C98FF`, stroke width 1.75.

### Navigation bar

| Part | Spec |
|---|---|
| Bar | Height 72px, `container.wide` (1360px). When sticky: `surface.glass` + `blur.glass` + `border.subtle` along the bottom. |
| Brand | 24px logo tile with radius 7px and `gradient.cobalt`, plus the wordmark at 16px / 600 / -0.01em, 10px gap |
| Item group | Pill container, 4px padding, `border.default`, fill `rgba(255,255,255,0.03)`, 2px gap |
| Item | Height 36px, horizontal padding 16px, 14px / 500, pill radius |
| Item: rest | Text `#A9AEC4` |
| Item: hover | Fill `rgba(255,255,255,0.05)`, text `#F5F6FA` |
| Item: active | Fill `rgba(255,255,255,0.10)`, text `#F5F6FA`, `aria-current="page"` |
| Item: focus | `ring.focus` |
| Right side | Ghost "Log in" + a CTA button (8px gap). Use secondary when the hero already shows a primary button (one primary per view). |
| Mobile (under 768px) | Items collapse into a 40px ghost menu button that opens a full-height overlay sheet (see proposal 4) |

### Badges

Height 24px · horizontal padding 10px · `radius.pill` · 12px / 500 · 6px dot · 6px gap.
Fill = the color at 12% · border = the color at 28% · text and dot = the color.

| Variant | Fill | Border | Text / dot |
|---|---|---|---|
| Neutral | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.12)` | `#CDD1E0` |
| Brand | `rgba(66,85,245,0.18)` | `rgba(100,116,250,0.30)` | `#8C98FF` |
| New (accent) | `rgba(167,139,250,0.12)` | `rgba(167,139,250,0.28)` | `#A78BFA` |
| Success | `rgba(61,214,140,0.12)` | `rgba(61,214,140,0.28)` | `#3DD68C` |
| Warning | `rgba(245,181,68,0.12)` | `rgba(245,181,68,0.28)` | `#F5B544` |
| Error | `rgba(242,109,109,0.12)` | `rgba(242,109,109,0.28)` | `#F26D6D` |
| Info | `rgba(90,169,245,0.12)` | `rgba(90,169,245,0.28)` | `#5AA9F5` |

Badges show status and are not buttons, so they have no hover state. If something is clickable it is a **filter chip**: height 32px with secondary button styling, and its selected state is fill `rgba(255,255,255,0.10)` with border `rgba(255,255,255,0.24)`.

### Modal

| Part | Spec |
|---|---|
| Width | 480px (sm) / 640px (md) |
| Container | Padding 32px, `radius.2xl` (28px), `surface.overlay` + `blur.overlay`, shadow `e4`, 24px gap between blocks |
| Scrim | `rgba(5,6,11,0.72)` + `blur.scrim`. Clicking it closes the modal unless the action is destructive. |
| Header | H3 title (24px / 600), Body description at 15px in `#A9AEC4`, 8px gap |
| Close button | 36px round ghost button, fill `rgba(255,255,255,0.06)`, icon `#A9AEC4`, top-right, `aria-label="Close"` |
| Body → footer | 24px gap, optional `border.subtle` divider |
| Footer | Right-aligned, 12px gap: secondary, then primary (or destructive) |
| Motion | Enter in 200ms: opacity 0→1, scale 0.96→1, y 8px→0. Exit in 140ms, reversed. |
| Accessibility | `role="dialog"` and `aria-modal="true"`. Trap focus, put first focus on the least destructive action, close on Esc, and return focus to the trigger. |
| Mobile | Becomes a bottom sheet: full width, radius `28px 28px 0 0`, 24px padding, buttons stacked full width |

---

## 7. CSS custom properties

A starting point for implementation.

```css
:root {
  /* Brand */
  --color-primary-300: #8C98FF;
  --color-primary-400: #6474FA;
  --color-primary-500: #4255F5;
  --color-primary-600: #2F3FD6;
  --color-primary-700: #1E2690;

  --color-secondary-100: #ECEEF3;
  --color-secondary-200: #DADDE6;
  --color-secondary-300: #C7CBD6;
  --color-secondary-400: #9AA0B2;
  --color-secondary-500: #6E7488;

  --color-accent-200: #DDD3FE;
  --color-accent-300: #C4B2FC;
  --color-accent-400: #A78BFA;
  --color-accent-500: #8B67F0;
  --color-accent-600: #6D48D4;

  /* Neutrals */
  --neutral-50:  #F5F6FA;
  --neutral-100: #E8EAF2;
  --neutral-200: #CDD1E0;
  --neutral-300: #A9AEC4;
  --neutral-400: #7F85A0;
  --neutral-500: #5C627D;
  --neutral-600: #424760;
  --neutral-700: #2D3148;
  --neutral-800: #1A1D2E;
  --neutral-900: #0E1020;
  --neutral-950: #07080F;

  /* Background & surfaces */
  --bg-canvas: #07080F;
  --surface-1: #0E1020;
  --surface-2: #1A1D2E;
  --surface-glass: rgba(255, 255, 255, 0.04);
  --surface-overlay: rgba(18, 20, 42, 0.85);
  --surface-scrim: rgba(5, 6, 11, 0.72);

  /* Text */
  --text-primary: #F5F6FA;
  --text-secondary: #A9AEC4;
  --text-muted: #7F85A0;
  --text-disabled: #5C627D;
  --text-brand: #8C98FF;
  --text-inverse: #07080F;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.20);
  --border-focus: #6474FA;
  --ring-focus: 0 0 0 2px #07080F, 0 0 0 4px #8C98FF;

  /* Semantic */
  --success: #3DD68C;
  --warning: #F5B544;
  --error:   #F26D6D;
  --info:    #5AA9F5;

  /* Typography */
  --font-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* Spacing */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
  --space-12: 48px; --space-16: 64px; --space-20: 80px; --space-24: 96px;
  --space-32: 128px;

  /* Containers */
  --container-wide: 1360px;
  --container-default: 1200px;
  --container-narrow: 720px;
  --measure-body: 560px;

  /* Radius */
  --radius-xs: 6px;  --radius-sm: 10px; --radius-md: 12px; --radius-lg: 16px;
  --radius-xl: 20px; --radius-2xl: 28px; --radius-pill: 999px;

  /* Elevation */
  --e0: none;
  --e1: inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.40);
  --e2: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -8px rgba(0,0,0,0.60);
  --e3: inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 48px -12px rgba(0,0,0,0.70);
  --e4: 0 0 0 1px rgba(255,255,255,0.08), 0 40px 80px -20px rgba(0,0,0,0.80);
  --glow-brand: 0 24px 60px -16px rgba(66,85,245,0.55);

  /* Gradients */
  --gradient-glow: radial-gradient(60% 55% at 65% 40%, rgba(66,85,245,0.55), rgba(66,85,245,0) 70%);
  --gradient-cobalt: linear-gradient(135deg, #5468F5 0%, #2F3FD6 55%, #1E2690 100%);
  --gradient-platinum: linear-gradient(135deg, #ECEEF3 0%, #C7CBD6 50%, #9AA0B2 100%);
  --divider-fade: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.20), rgba(255,255,255,0));

  /* Blur */
  --blur-glass: blur(20px) saturate(140%);
  --blur-overlay: blur(24px);
  --blur-scrim: blur(8px);

  /* Motion */
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration: 160ms;
}
```

---

## 8. Open proposals (not yet adopted)

These came up while building an example page with the system. They are **not part of v1.0** until approved.

1. **Footer pattern.** `divider.fade` on top, then a two-tone H2 with an email link (`text.brand`) on the left and secondary-button social links on the right. Padding: 96px top (64px on mobile), 48px before the caption row, 32px at the bottom. The caption row uses `type.caption` in `text.muted` with a `border.subtle` top border.
2. **Icon set & social links.** Adopt one icon set (e.g. Lucide, free) at 16px and 20px with a 1.75px stroke. A social link becomes either a secondary button with a label and arrow icon, or a 40px round ghost icon button. Decide whether official brand logos may be used.
3. **Image frame & avatar.** An image frame component with a 4:5 or 1:1 aspect ratio, `radius.2xl`, `border.default` and `glow.brand` behind it, plus a 40px round avatar.
4. **Mobile menu.** A 40px round ghost menu button and a full-height sheet using `surface.overlay` and the modal's bottom-sheet spec.
5. **Link hover color.** Links currently hover to `#B7BEFF`, which isn't in the palette. Either add it as `color.primary.200` or keep links at Cobalt 300 and underline them on hover.
6. **Fluid page margin.** Adopt `page.margin: clamp(16px, 5vw, 80px)` as a token, or keep the fixed per-breakpoint margins (16 / 32 / 48 / 80px).
