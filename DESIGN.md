# Design System — Weego CMI

## Product Context
- **What this is:** B2B SaaS dashboard for managing own couriers at Ukrainian food & beverage establishments (restaurants, cafes, pizzerias)
- **Who it's for:** Two users — (1) manager/owner of a small establishment (1–5 couriers), views on laptop, needs trust and clarity under stress; (2) courier on a smartphone, needs maximum simplicity
- **Space/industry:** Last-mile delivery management (HoReCa), Ukraine 2026
- **Project type:** Web operational dashboard (Next.js) + mobile courier app (React Native/Expo)
- **Competitive context:** Onfleet, Circuit, Onro, Upper — all use light dashboards. We deliberately diverge.

---

## Aesthetic Direction
- **Direction:** Industrial / Command Center
- **Decoration level:** Minimal — typography and color carry all meaning; no decoration for decoration's sake
- **Mood:** Authoritative and focused. The manager opens this at 20:00 with 8 active orders. The product should feel like a control room — every element is there for a reason, nothing distracts, status information pops immediately.
- **Key differentiation:** Every competitor uses a light dashboard. Weego is dark-first, creating visual continuity with the mobile courier app and standing out immediately in the category.

---

## Typography

- **Primary UI font:** [Onest](https://fonts.google.com/specimen/Onest) — modern geometric grotesque developed by Ukrainian designers, excellent native Cyrillic coverage, clean at small sizes. Available on Google Fonts.
- **Data / Monospace:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — for timestamps, order numbers, delivery counts, battery percentages, any numerical data. Tabular figures by default.
- **Loading strategy:** Google Fonts CDN with `display=swap`, preconnect tags in `<head>`

### Type Scale

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| Display | 28–32px | 700 | Page hero titles, empty states |
| Heading 1 | 20px | 600 | Section titles, modal headers |
| Heading 2 | 16px | 600 | Card titles, sidebar section labels |
| Body | 14px | 400 | General text, descriptions |
| Label | 13px | 500 | Table cells, form labels, list items |
| Caption | 12px | 400–500 | Timestamps, secondary info |
| Micro | 11px | 500–600 | Badges, pill labels, table headers (uppercase + tracking) |
| Mono | 13px | 400–500 | Data values, IDs, timestamps (JetBrains Mono) |

---

## Color

- **Approach:** Restrained — one primary accent, semantic colors for status, neutrals for everything else. Color is rare and meaningful.

### Core Palette

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `--bg` | `#0f172a` | `slate-900` | Page background |
| `--surface` | `#1e293b` | `slate-800` | Cards, sidebar, panels |
| `--surface-2` | `#263345` | between slate-800/700 | Hover states, nested surfaces |
| `--border` | `#334155` | `slate-700` | Dividers, card borders, input borders |
| `--border-2` | `#475569` | `slate-600` | Focus rings (before primary), stronger borders |
| `--text-1` | `#f8fafc` | `slate-50` | Primary text |
| `--text-2` | `#cbd5e1` | `slate-300` | Secondary text, descriptions |
| `--text-3` | `#94a3b8` | `slate-400` | Tertiary text, labels, placeholders |
| `--text-4` | `#64748b` | `slate-500` | Disabled, timestamps, meta |

### Accent & Semantic

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `--primary` | `#2563eb` | `blue-600` | Primary actions, links, focus rings |
| `--primary-hover` | `#1d4ed8` | `blue-700` | Button hover |
| `--primary-muted` | `rgba(37,99,235,.15)` | — | Tinted backgrounds (active nav item, badges) |
| `--success` | `#16a34a` | `green-600` | Completed deliveries, online status |
| `--success-muted` | `rgba(22,163,74,.15)` | — | Success badge background |
| `--warning` | `#ca8a04` | `yellow-600` | Background GPS mode, delayed orders |
| `--warning-muted` | `rgba(202,138,4,.15)` | — | Warning badge background |
| `--danger` | `#dc2626` | `red-600` | Not-responding couriers, errors, cancellations |
| `--danger-muted` | `rgba(220,38,38,.15)` | — | Danger badge background |
| `--info` | `#0891b2` | `cyan-600` | Informational alerts, new POS orders |

### Courier Status Colors (established mental model — do not change)

| Status | Dot color | Label color | Condition |
|--------|-----------|-------------|-----------|
| 🟢 Онлайн | `#4ade80` | `green-400` | ping < 30s |
| 🟡 Фон | `#fbbf24` | `yellow-400` | ping 30s–5min |
| 🔴 Не відповідає | `#f87171` | `red-400` | ping > 5min during active delivery |
| ⚫ Офлайн | `#64748b` | `slate-500` | no active delivery + ping > 5min |

### Dark Mode Strategy
Dark mode IS the primary mode. If a light mode variant is ever needed, increase surface lightness, switch border colors to `#e2e8f0`, text to `#0f172a`. Reduce accent saturation by ~10%.

---

## Spacing

- **Base unit:** 4px
- **Density:** Compact — this is an operational tool, not a marketing landing page
- **Philosophy:** Pack information. Managers have 8 orders on screen simultaneously; every extra padding pixel is wasted space.

### Scale

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps (badge padding, dot margins) |
| `space-2` | 8px | Inner component padding (sm buttons, list items) |
| `space-3` | 12px | Standard gap between related elements |
| `space-4` | 16px | Card padding, form field spacing |
| `space-5` | 20px | Section internal padding |
| `space-6` | 24px | Card-to-card gap, modal padding |
| `space-8` | 32px | Section spacing |
| `space-12` | 48px | Major section breaks |

---

## Layout

- **Approach:** Grid-disciplined
- **Dashboard shell:** Dark sidebar (240px) + main content area
- **Max content width:** 1440px (desktop), fluid below
- **Grid:** 12 columns at ≥1280px, 4 columns at <768px
- **Breakpoints:** sm:640px, md:768px, lg:1024px, xl:1280px

### Border Radius — Small, not bubbly

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 4px | Badges, pills, small buttons |
| `rounded-md` | 6px | Buttons (default), inputs |
| `rounded-lg` | 8px | Cards, dropdowns, panels |
| `rounded-xl` | 12px | Modals, large containers |
| `rounded-full` | 9999px | Status dots, avatar circles |

### Shadows — Subtle, dark-appropriate

```css
--shadow-sm:  0 1px 2px rgba(0,0,0,.4);
--shadow-md:  0 4px 12px rgba(0,0,0,.5);
--shadow-lg:  0 8px 24px rgba(0,0,0,.6);
```

---

## Motion

- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Philosophy:** This is an operational tool. Animations must not slow down perception. Status changes should feel instant.
- **Easing:** `ease-out` for enter, `ease-in` for exit, `ease-in-out` for state changes

### Duration

| Token | Value | Usage |
|-------|-------|-------|
| `duration-micro` | 80ms | Button hover, dot color change |
| `duration-short` | 150ms | Status badge update, input focus ring |
| `duration-medium` | 200ms | Dropdown open, modal fade |
| `duration-long` | 300ms | Toast slide-in, page transition |

**Never:** bounce animations, spring physics, scroll-driven effects. Those are for consumer apps.

---

## Component Guidelines (shadcn/ui mapping)

| Component | shadcn base | Customization |
|-----------|-------------|---------------|
| Button | `Button` | variant: `default` (primary), `outline` (secondary), `ghost`, `destructive` |
| Badge | `Badge` | Custom variants: `online`, `background`, `not_responding`, `offline` |
| Status pill | `Badge` | Monospace font, square border-radius, semantic bg tint |
| Card | `Card` | Dark surface, slate-700 border, 8px radius |
| Table | `Table` | Compact rows (py-2.5), slate-700 dividers, hover on surface-2 |
| Input | `Input` | Dark bg, slate-700 border, blue focus ring, slate-500 placeholder |
| Modal | `Dialog` | Centered, max-w-sm, dark overlay `bg-black/50` |
| Alert | `Alert` | 4 variants with muted bg tints (see semantic colors) |
| Select | `Select` | Same as Input, dark dropdown |
| Tooltip | `Tooltip` | Dark surface-2, short duration |

---

## Tailwind Config Additions

```js
// tailwind.config.ts — extend with:
fontFamily: {
  ui:   ['Onest', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'monospace'],
},
colors: {
  // Weego design tokens mapped to Tailwind
  bg:       '#0f172a',
  surface:  '#1e293b',
  'surface-2': '#263345',
  // ... use slate-* for the rest (already in Tailwind)
},
borderRadius: {
  sm: '4px', DEFAULT: '6px', md: '6px', lg: '8px', xl: '12px',
},
```

---

## Do / Don't

| ✅ Do | ❌ Don't |
|-------|---------|
| Use `text-slate-400` for secondary text | Mix multiple shades of blue |
| Use JetBrains Mono for all numerical values | Use Inter or Roboto as primary font |
| Use status colors consistently (green/yellow/red/gray) | Add decoration that doesn't serve a function |
| Keep border-radius ≤ 8px for cards | Use `rounded-2xl` or `rounded-3xl` on cards |
| Use `bg-opacity` tints for badge backgrounds | Use solid colors for badge backgrounds (too loud) |
| Compact padding (py-2.5 px-3 for table rows) | Spacious padding optimized for demos |
| monospace for timestamps, IDs, percentages | Sans-serif for numerical data |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-22 | Dark-first dashboard | All competitors use light dashboards; dark creates command-center authority and continuity with courier mobile app (already dark). Ukrainian HoReCa managers are familiar with dark UIs (Glovo, Bolt). |
| 2026-03-22 | Onest as primary typeface | Ukrainian-developed font with native Cyrillic support. Signals "built for Ukraine". No competitor in the courier management SaaS space uses a Cyrillic-native font. |
| 2026-03-22 | JetBrains Mono for data | Tabular figures, excellent readability for timestamps and numbers at compact sizes. |
| 2026-03-22 | Compact density | Operational tool, not a marketing dashboard. Managers need maximum information density under time pressure. |
| 2026-03-22 | Border-radius ≤ 8px | Bubbly interfaces signal consumer/toy products. Sharp corners reinforce operational/professional character. |
| 2026-03-22 | Blue #2563eb as primary | Already established in mobile app; consistency across platforms. Familiar to Ukrainian app users (Glovo uses blue). |
| 2026-03-22 | Minimal motion | Status transitions must feel instant. No spring animations — this isn't a game. |
