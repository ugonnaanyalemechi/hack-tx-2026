# Foundry Design System

**Version 2.0 · October 2026** (replaces Nocturne 1.0)

Foundry is the visual language of an agent foundry: agents are forged, tested and shipped. It uses a gunmetal ground, machined steel plates, brushed-steel actions, one molten amber light, and a stalwart serif set against instrument-panel mono.

**The feel in three words: forged, stalwart, precise.**

Reference mockups: `docs/design/foundry/foundry-mockups.html` (rendered as `catalog.png`, `chat.png`, `budget.png` in the same folder). The old Nocturne PNGs in `docs/design/` show the layouts, which are unchanged; only the skin differs.

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

| # | Principle | Rule |
|---|---|---|
| P1 | **Gunmetal ground, steel as signal** | The page is gunmetal (`#0E1012`). Bright brushed steel is spent only on what should be clicked first: the primary pill. Primary text is `#ECEEF0`. |
| P2 | **One ember per view** | A single warm, low radial glow (molten amber) sits behind the hero. Everything else is flat. Depth comes from that light and from plate edges, not from many shadows. |
| P3 | **Pills act, plates hold** | Anything you press (buttons, nav, badges, filters) is a full pill. Anything that contains content is a machined plate with a tight 8-12px radius. |
| P4 | **Serif claims, mono measures** | Headlines are IBM Plex Serif and state the claim in primary text, finishing the thought in muted steel on the next line. Labels, overlines, table headers, numbers and data are Geist Mono, uppercase, wide-tracked. Body is Geist. |
| P5 | **Plates have edges** | Cards get a 1px top-edge highlight and a hairline border, like a machined plate. A very faint brushed grain (at most 3% opacity) may sit on the canvas. Glass only where something real sits behind it. |
| P6 | **One accent, honest semantics** | Molten amber is the only accent: focus, selected, progress, citations, the ember. Warning is yellow (`#E8C547`) so it never reads as the accent. |
| P7 | **Precise, plain tone** | Proof over adjectives: exact figures, short labels, sentence case (Overline excepted). Set numbers in mono with a small caption under them. |

### Don'ts

1. **No competing lights.** Never put two steel primary buttons, two glows or a large amber fill in one view. The signal only works if it is singular.
2. **No gradient text.** The two-tone headline is two solid colors.
3. **No soft, bubbly rectangles.** Cards stay at 8-12px radius; only actions are pills.
4. **No hardcoded values in components.** Colors, fonts, radii and gradients come from the tokens in `web/app/globals.css`.
5. **No amber for warnings.** Use `warning` (yellow) so a warning is never confused with a selected or focused state.

---

## 2. Color

All tokens are defined once in `web/app/globals.css` (`@theme` block). The `--color-primary-*` scale is the molten accent (the names were kept from Nocturne so components keep working).

### Brand: Molten (`color.primary.*`)

| Token | Hex | Use |
|---|---|---|
| `primary.300` | `#FFB15C` | **Light.** Text on dark (overlines, links, citations), focus ring offset color |
| `primary.400` | `#F79D3E` | Hover on amber fills |
| `primary.500` | `#F08A24` | **Base.** Focus ring, selected state, progress bars, approve action |
| `primary.600` | `#D9731A` | Pressed amber fill |
| `primary.700` | `#B85A10` | **Deep.** Ember glow edge, gradient end |

Text on `primary.500` fills is `text.inverse` (`#0E1012`), never white (white on amber is only 2.4:1).

### Secondary: Steel (`color.secondary.*`)

| Token | Hex |
|---|---|
| `secondary.100` | `#EEF0F2` |
| `secondary.200` | `#D8DCE0` |
| `secondary.300` | `#C2C7CD` |
| `secondary.400` | `#9AA1A9` |
| `secondary.500` | `#6F767F` |

`color.accent.*` aliases the molten scale (Foundry has one accent).

### Neutral scale (`color.neutral.*`), cool steel gray, hue about 210

| Token | Hex | Use |
|---|---|---|
| `neutral.50` | `#F3F5F6` | |
| `neutral.100` | `#ECEEF0` | Primary text |
| `neutral.200` | `#D2D6DA` | |
| `neutral.300` | `#A8AEB6` | Secondary text |
| `neutral.400` | `#7C838C` | Muted text |
| `neutral.500` | `#5A6068` | |
| `neutral.600` | `#3E444B` | |
| `neutral.700` | `#2A2F36` | Surface 3 |
| `neutral.800` | `#1F2329` | Surface 2 |
| `neutral.900` | `#16191D` | Surface 1 |
| `neutral.950` | `#0E1012` | Canvas |

### Background & surfaces

| Token | Value | Use |
|---|---|---|
| `bg.canvas` | `#0E1012` | Page background everywhere |
| `bg.glow` | `radial-gradient(60% 55% at 65% 40%, rgba(240,138,36,0.40), rgba(184,90,16,0.12) 45%, transparent 72%)` | Warm ember behind the hero. **One per view.** |
| `surface.1` | `#16191D` | Cards (plates), sidebars, tables |
| `surface.2` | `#1F2329` | Raised items inside surface 1, menus, tooltips |
| `surface.3` | `#2A2F36` | Selected nav pills, pressed items |
| `surface.glass` | `rgba(255,255,255,0.04)` | Translucent layers over the glow |
| `surface.overlay` | `rgba(22,25,29,0.88)` + blur | Modals, popovers |
| `surface.scrim` | `rgba(5,7,8,0.72)` + blur | Behind modals |

### Text

| Token | Hex | Contrast on canvas | Use |
|---|---|---|---|
| `text.primary` | `#ECEEF0` | 16:1 | Headlines, emphasis |
| `text.secondary` | `#A8AEB6` | 8:1 | Body copy, descriptions |
| `text.muted` | `#7C838C` | 4.9:1 | Captions, metadata, headline second line |
| `text.disabled` | `#555B63` | 2.7:1 (warning) | Disabled labels only |
| `text.brand` | `#FFB15C` | 10:1 | Overlines, links, citations |
| `text.inverse` | `#0E1012` | 14:1 on steel, 8:1 on amber | Labels on steel and amber fills |

### Borders

| Token | Value | Use |
|---|---|---|
| `border.subtle` | `rgba(255,255,255,0.07)` | Dividers inside a plate |
| `border.default` | `rgba(255,255,255,0.10)` | Card and input hairlines |
| `border.strong` | `rgba(255,255,255,0.18)` | Hover, dashed placeholders |
| `border.focus` | `#F08A24` | Focus and selected |

### Semantic

| Token | Hex | Use |
|---|---|---|
| `success` | `#3DD68C` | Live, passed, on track |
| `warning` | `#E8C547` | Budget at 80%, paused, needs attention (yellow, not amber) |
| `error` | `#F26D6D` | Failed, blocked, over cap |
| `info` | `#5AA9F5` | Neutral information |

### Contrast concerns (WCAG 2.2)

- `text.disabled` fails 4.5:1. Use it only on disabled controls, never for readable content.
- Never put white text on an amber fill. Use `text.inverse`.
- Status is never shown by color alone: badges carry a label, and meters carry a number.

---

## 3. Typography

### Font families

All three are free on Google Fonts (OFL) and loaded with `next/font/google` in `web/app/layout.tsx` as CSS variables.

| Role | Family | Weights | Variable |
|---|---|---|---|
| Headings, display, wordmark | **IBM Plex Serif** | 500 · 600 | `--font-plex-serif` → `font-serif` |
| UI and body | **Geist** | 400 · 500 · 600 | `--font-geist-sans` → `font-sans` |
| Overlines, labels, table headers, data, numbers, code | **Geist Mono** | 400 · 500 | `--font-geist-mono` → `font-mono` |

`h1`-`h4` and `CardTitle` use Plex Serif by default (base layer). Use `font-variant-numeric: tabular-nums` on figures.

### Type scale

| Token | Size | Line height | Weight | Letter spacing | Font | Use when |
|---|---|---|---|---|---|---|
| `type.h1` | 44px (32px below 768px) | 1.1 | 500 | -0.02em | Serif | Page title inside the product. One per screen. |
| `type.h3` | 24px | 1.25 | 500 | -0.015em | Serif | Card titles, approval titles, sub-sections |
| `type.h4` | 18px | 1.35 | 600 | -0.01em | Serif | Small card titles, list group headings |
| `type.stat` | 32px | 1 | 500 | -0.02em | Mono | Key figures, tabular, with an overline caption beneath |
| `type.body-l` | 18px | 1.55 | 400 | -0.005em | Sans | Hero lead paragraph (`text.secondary`) |
| `type.body` | 16px | 1.55 | 400 | 0 | Sans | Default reading text |
| `type.body-s` | 14px | 1.5 | 400 | 0 | Sans | Card descriptions, table cells |
| `type.label` | 14px | 1 | 500 | 0 | Sans | Buttons, nav items, tabs |
| `type.caption` | 12px | 1.4 | 400 | 0.01em | Sans | Helper text, timestamps (`text.muted`) |
| `type.overline` | 11px | 1.2 | 500 | **0.12em** | **Mono, uppercase** | Above section titles, table headers, stat captions, tags (`text.brand` or `text.muted`) |
| `type.wordmark` | 16px | 1 | 600 | **0.18em** | Serif, uppercase | "FOUNDRY" with a small amber spark (`bg-spark`) |

### Rules

- **Headline pairing.** Claim in `text.primary`, the finishing thought in `text.muted` on the next line. Gap from overline to headline is 16px. Body copy stops at 560px.
- **Weights.** 500/600 for serif headings, 500 for labels and numerals, 400 for reading. Never 700 or heavier.
- **Mono is for measuring.** Anything that is a label, a count, a cost, an ID, a tool name or a citation chip is Geist Mono; sentences are never mono.

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
| `radius.xs` | 4px | Checkboxes, tiny tags, code |
| `radius.sm` | 6px | Menu items, swatches, tooltips |
| `radius.md` | 8px | Inputs, selects, small tiles, icon tiles |
| `radius.lg` | 10px | Floating chips, toasts, list cards |
| `radius.xl` | 12px | Cards (machined plates), panels, stat bars |
| `radius.2xl` | 16px | Modals, chat bubbles, hero objects |
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
| `glow.brand` | `0 14px 40px -16px rgba(240,138,36,0.25)` | Under molten brand objects (approval card) |

### Gradients

| Token | Value | Use |
|---|---|---|
| `gradient.glow` (`bg-glow`) | `radial-gradient(60% 55% at 65% 40%, rgba(240,138,36,0.40), rgba(184,90,16,0.12) 45%, transparent 72%)` | Warm ember behind the hero. **One per view.** |
| `gradient.steel` (`bg-steel`) | `linear-gradient(180deg, #F2F4F6 0%, #C9CED4 55%, #A3AAB2 100%)` + `inset 0 1px 0 rgba(255,255,255,0.6)` | Primary action pill. Label `#0E1012`. |
| `gradient.molten` (`bg-molten`) | `linear-gradient(180deg, #FFB15C 0%, #F08A24 55%, #D9731A 100%)` + `inset 0 1px 0 rgba(255,255,255,0.45)` | Approve / spend actions and the user chat bubble. Label `#0E1012`. |
| `gradient.plate` (`bg-plate`) | `linear-gradient(180deg, rgba(255,255,255,0.025), transparent 40%)` over `surface.1` | Card sheen, like a top-lit machined plate |
| `gradient.spark` (`bg-spark`) | `radial-gradient(circle at 35% 30%, #FFD9A6, #F08A24 55%, #B85A10)` + `0 0 10px 2px rgba(240,138,36,0.55)` | The 8px ember beside the wordmark |
| `texture.brushed` | `repeating-linear-gradient(90deg, rgba(255,255,255,0.011) 0 1px, transparent 1px 3px)` | Canvas grain. Never above 3% opacity. |

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
- Focus ring everywhere: `0 0 0 2px #0E1012, 0 0 0 4px #F08A24` (2px ring, 2px offset)
- Minimum hit area 40px, or 44px on touch

### Buttons

Shape `radius.pill` · label `type.label` (14px / 500) · 8px gap between label and icon.

**Sizes**

| Size | Height | Horizontal padding | Font size | Use |
|---|---|---|---|---|
| `sm` | 32px | 14px | 13px | Nav, compact toolbars |
| `md` (default) | 40px | 18px | 14px | Everywhere else |
| `lg` | 48px | 22px | 15px | Hero CTAs |

**Primary**: the one main action per view. A brushed-steel pill (`bg-steel`).

| State | Background | Text | Border | Other |
|---|---|---|---|---|
| Default | `gradient.steel` | `#0E1012` | none | inset 1px top highlight `rgba(255,255,255,0.6)` |
| Hover | `gradient.steel` | `#0E1012` | none | `filter: brightness(1.1)` |
| Pressed | `gradient.steel` | `#0E1012` | none | `transform: translateY(1px)` |
| Focus | `gradient.steel` | `#0E1012` | none | `ring.focus` (amber) |
| Disabled | `surface.2` | `#555B63` | none | `cursor: not-allowed` |

**Approve** (amber, `bg-molten`): the decision that spends or changes something (approval card, approve spend). Dark label `#0E1012`. Never shown beside a second steel primary in the same group.

**Secondary**: an alternative action beside the primary. An outlined pill.

| State | Background | Text | Border | Other |
|---|---|---|---|---|
| Default | `transparent` | `#ECEEF0` | `1px solid rgba(255,255,255,0.16)` | |
| Hover | `rgba(255,255,255,0.06)` | `#ECEEF0` | `1px solid rgba(255,255,255,0.24)` | |
| Pressed | `rgba(255,255,255,0.10)` | `#ECEEF0` | `1px solid rgba(255,255,255,0.24)` | `transform: scale(0.98)` |
| Focus | `transparent` | `#ECEEF0` | `1px solid rgba(255,255,255,0.16)` | `ring.focus` |
| Disabled | `transparent` | `#555B63` | `1px solid rgba(255,255,255,0.08)` | `cursor: not-allowed` |

**Ghost**: tertiary actions, toolbars, nav links, "Log in". Text only.

| State | Background | Text | Other |
|---|---|---|---|
| Default | `transparent` | `#A8AEB6` | |
| Hover | `rgba(255,255,255,0.06)` | `#ECEEF0` | |
| Pressed | `rgba(255,255,255,0.10)` | `#ECEEF0` | |
| Focus | `transparent` | `#ECEEF0` | `ring.focus` |
| Disabled | `transparent` | `#3E444B` | `cursor: not-allowed` |

**Destructive confirm** (in modals): fill `#F26D6D`, label `#0E1012`.

### Inputs

Height 44px · horizontal padding 16px · `radius.md` (8px) · text 15px / 400 · label 13px / 500 with an 8px gap below it · helper text 12px / 400.

| State | Fill | Border | Text | Label | Helper | Other |
|---|---|---|---|---|---|---|
| Default | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | `#ECEEF0` | `#A8AEB6` | `#7C838C` | placeholder `#7C838C` |
| Hover | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.20)` | `#ECEEF0` | `#A8AEB6` | `#7C838C` | |
| Focus | `rgba(255,255,255,0.05)` | `#F08A24` | `#ECEEF0` | `#ECEEF0` | `#7C838C` | `box-shadow: 0 0 0 4px rgba(240,138,36,0.22)` |
| Error | `rgba(242,109,109,0.06)` | `#F26D6D` | `#ECEEF0` | `#A8AEB6` | `#F26D6D` + icon | |
| Disabled | `rgba(255,255,255,0.02)` | `rgba(255,255,255,0.06)` | `#555B63` | `#555B63` | `#555B63` | |

### Cards

| Variant | Padding | Radius | Fill | Border | Shadow | Notes |
|---|---|---|---|---|---|---|
| **Content card** | 24px | 12px | `surface.1` + `gradient.plate` | `border.default` | `e1` (top-edge highlight) | 12px gap. Icon tile, H4 title, Body S description. |
| Content card: hover | 24px | 12px | `surface.1` | `border.strong` | `e2` | `transform: translateY(-2px)`; focus uses `ring.focus` on the whole card |
| **Stat bar** | 24px per cell | 20px | `rgba(255,255,255,0.03)` | `border.default` | none | `type.stat` + `type.caption`; `border.subtle` between cells |
| **Floating chip** | 12px 16px | 16px | `rgba(255,255,255,0.06)` + `blur.glass` | `rgba(255,255,255,0.14)` | `e2` | 32px round icon (`#F08A24` fill, dark check), 12px gap |
| **Brand object** | | 16px | `gradient.molten` | none | `glow.brand` | Hero object only |

**Icon tile** (inside a content card): 40×40px, radius 8px, fill `rgba(240,138,36,0.16)`, border `rgba(240,138,36,0.30)`, 20px stroke icon in `#FFB15C`, stroke width 1.75.

### Navigation bar

| Part | Spec |
|---|---|
| Bar | Height 72px, `container.wide` (1360px). When sticky: `surface.glass` + `blur.glass` + `border.subtle` along the bottom. |
| Brand | 8px amber spark (`gradient.spark`) plus the wordmark "FOUNDRY" in Plex Serif 600, 16px, uppercase, tracking 0.18em, 10px gap |
| Item group | Pill container, 4px padding, `border.default`, fill `rgba(255,255,255,0.03)`, 2px gap |
| Item | Height 36px, horizontal padding 16px, 14px / 500, pill radius |
| Item: rest | Text `#A8AEB6` |
| Item: hover | Fill `rgba(255,255,255,0.05)`, text `#ECEEF0` |
| Item: active | Fill `surface.3` (`#2A2F36`), top highlight, text `#ECEEF0`, `aria-current="page"` |
| Item: focus | `ring.focus` |
| Right side | Ghost "Log in" + a CTA button (8px gap). Use secondary when the hero already shows a primary button (one primary per view). |
| Mobile (under 768px) | Items collapse into a 40px ghost menu button that opens a full-height overlay sheet (see proposal 4) |

### Badges

Height 24px · horizontal padding 10px · `radius.pill` · Geist Mono 11px / 500, uppercase, tracking 0.12em on status badges · 6px dot · 6px gap.
Fill = the color at 12% · border = the color at 28% · text and dot = the color.

| Variant | Fill | Border | Text / dot |
|---|---|---|---|
| Neutral | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.12)` | `#D2D6DA` |
| Brand (molten) | `rgba(240,138,36,0.18)` | `rgba(240,138,36,0.30)` | `#FFB15C` |
| Success | `rgba(61,214,140,0.12)` | `rgba(61,214,140,0.28)` | `#3DD68C` |
| Warning (yellow, not amber) | `rgba(232,197,71,0.12)` | `rgba(232,197,71,0.28)` | `#E8C547` |
| Error | `rgba(242,109,109,0.12)` | `rgba(242,109,109,0.28)` | `#F26D6D` |
| Info | `rgba(90,169,245,0.12)` | `rgba(90,169,245,0.28)` | `#5AA9F5` |

Badges show status and are not buttons, so they have no hover state. If something is clickable it is a **filter chip**: height 32px with secondary button styling, and its selected state is fill `rgba(255,255,255,0.10)` with border `rgba(255,255,255,0.24)`.

### Modal

| Part | Spec |
|---|---|
| Width | 480px (sm) / 640px (md) |
| Container | Padding 32px, `radius.2xl` (16px), `surface.overlay` + `blur.overlay`, shadow `e4`, 24px gap between blocks |
| Scrim | `rgba(5,7,8,0.72)` + `blur.scrim`. Clicking it closes the modal unless the action is destructive. |
| Header | H3 title (24px / 600), Body description at 15px in `#A8AEB6`, 8px gap |
| Close button | 36px round ghost button, fill `rgba(255,255,255,0.06)`, icon `#A8AEB6`, top-right, `aria-label="Close"` |
| Body → footer | 24px gap, optional `border.subtle` divider |
| Footer | Right-aligned, 12px gap: secondary, then primary (or destructive) |
| Motion | Enter in 200ms: opacity 0→1, scale 0.96→1, y 8px→0. Exit in 140ms, reversed. |
| Accessibility | `role="dialog"` and `aria-modal="true"`. Trap focus, put first focus on the least destructive action, close on Esc, and return focus to the trigger. |
| Mobile | Becomes a bottom sheet: full width, radius `16px 16px 0 0`, 24px padding, buttons stacked full width |

---

## 7. CSS custom properties

The source of truth is the `@theme inline` block in `web/app/globals.css`. This is a summary of its names and values.

```css
@theme inline {
  /* Fonts */
  --font-sans: var(--font-geist-sans), ...;
  --font-serif: var(--font-plex-serif), ui-serif, Georgia, serif;
  --font-mono: var(--font-geist-mono), ui-monospace, ...;
  --tracking-overline: 0.12em;
  --tracking-wordmark: 0.18em;

  /* Molten accent */
  --color-primary-300: #ffb15c; --color-primary-400: #f79d3e; --color-primary-500: #f08a24;
  --color-primary-600: #d9731a; --color-primary-700: #b85a10;

  /* Neutrals (cool steel, hue ~210) */
  --color-neutral-50: #f3f5f6;  --color-neutral-100: #eceef0; --color-neutral-200: #d2d6da;
  --color-neutral-300: #a8aeb6; --color-neutral-400: #7c838c; --color-neutral-500: #5a6068;
  --color-neutral-600: #3e444b; --color-neutral-700: #2a2f36; --color-neutral-800: #1f2329;
  --color-neutral-900: #16191d; --color-neutral-950: #0e1012;

  /* Surfaces and text */
  --color-canvas: #0e1012;
  --color-surface-1: #16191d; --color-surface-2: #1f2329; --color-surface-3: #2a2f36;
  --color-text-primary: #eceef0; --color-text-secondary: #a8aeb6; --color-text-muted: #7c838c;
  --color-text-disabled: #555b63; --color-text-brand: #ffb15c; --color-text-inverse: #0e1012;

  /* Borders */
  --color-border-subtle: rgba(255,255,255,0.07);
  --color-border-default: rgba(255,255,255,0.10);
  --color-border-strong: rgba(255,255,255,0.18);
  --color-border-focus: #f08a24;

  /* Semantic */
  --color-success: #3dd68c; --color-warning: #e8c547; --color-error: #f26d6d; --color-info: #5aa9f5;

  /* Radius */
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px;
  --radius-xl: 12px; --radius-2xl: 16px; --radius-pill: 999px;

  /* Elevation */
  --shadow-e1: inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 2px rgba(0,0,0,0.5);
  --shadow-e2: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -8px rgba(0,0,0,0.7);

  /* Motion */
  --ease-foundry: cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* Utilities: bg-glow (ember), bg-steel (primary pill), bg-molten (approve pill),
   bg-plate (card sheen), bg-spark (wordmark ember). */
```

---

## 8. Open proposals (not yet adopted)

These came up while building an example page with the system. They are **not part of v1.0** until approved.

1. **Footer pattern.** `divider.fade` on top, then a two-tone H2 with an email link (`text.brand`) on the left and secondary-button social links on the right. Padding: 96px top (64px on mobile), 48px before the caption row, 32px at the bottom. The caption row uses `type.caption` in `text.muted` with a `border.subtle` top border.
2. **Icon set & social links.** Adopt one icon set (e.g. Lucide, free) at 16px and 20px with a 1.75px stroke. A social link becomes either a secondary button with a label and arrow icon, or a 40px round ghost icon button. Decide whether official brand logos may be used.
3. **Image frame & avatar.** An image frame component with a 4:5 or 1:1 aspect ratio, `radius.2xl`, `border.default` and `glow.brand` behind it, plus a 40px round avatar.
4. **Mobile menu.** A 40px round ghost menu button and a full-height sheet using `surface.overlay` and the modal's bottom-sheet spec.
5. **Link hover color.** Links currently hover to `#FFD9A6`, which isn't in the palette. Either add it as `color.primary.200` or keep links at Cobalt 300 and underline them on hover.
6. **Fluid page margin.** Adopt `page.margin: clamp(16px, 5vw, 80px)` as a token, or keep the fixed per-breakpoint margins (16 / 32 / 48 / 80px).
