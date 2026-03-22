# Design System — Weego CMI

## Product Context
- **What this is:** B2B SaaS for managing own couriers at Ukrainian HoReCa establishments
- **Who it's for:** Manager/owner (daily, laptop) + courier (smartphone, on the go)
- **References:** Apple, Vercel, Linear, Raycast — refined minimal, premium neutral
- **Anti-references:** Generic blue SaaS, Stripe (mass market), cheap rounded bubbly UI
- **Project type:** Operational dashboard (Next.js 14) + courier mobile app (React Native/Expo)

---

## Aesthetic Direction
- **Direction:** Refined Minimal / Premium Neutral
- **Decoration level:** None — typography and spacing carry all meaning
- **Mood:** Like opening a well-made professional tool. Nothing screams for attention. Everything is exactly where you need it. Vercel's discipline + Apple's warmth. The map IS the product — it's the hero of the dashboard.
- **Key rule:** If an element doesn't carry information or enable action — remove it.

---

## Typography

- **Primary UI font:** [Manrope](https://fonts.google.com/specimen/Manrope) — geometric grotesque with humanist touches, excellent native Cyrillic coverage, variable font (300–800 weight axis). Premium feel similar to Apple SF Pro but designed with Cyrillic in mind. Available on Google Fonts.
- **Mono / Data:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — for timestamps, order IDs, delivery counts, battery percentages, coordinates, any numerical data.
- **Loading:** `display=swap` + `preconnect` in `<head>`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

```css
body { font-family: 'Manrope', system-ui, sans-serif; }
.mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: "tnum"; }
```

### Type Scale

| Level | Size | Weight | Tracking | Usage |
|-------|------|--------|----------|-------|
| Display | 28–36px | 800 | -0.045em | Page hero, empty states |
| H1 | 20px | 700 | -0.025em | Page titles |
| H2 | 16px | 600 | -0.015em | Section titles, card headers |
| H3 | 14px | 600 | 0 | Subsection labels |
| Body | 14px | 400 | 0 | Descriptions, content |
| Label | 13px | 500 | 0 | Table cells, form values |
| Caption | 12px | 400 | 0 | Secondary info |
| Micro | 11px | 600 | +0.05em | Badges, table headers (UPPERCASE) |
| Mono | 13px | 500 | 0 | Data values, timestamps, IDs, coordinates |

Table headers (`<th>`) are always UPPERCASE, Micro size, letter-spacing +0.05em, `--text-4` color.

---

## Color

- **Approach:** Near-monochrome base with a single calm accent. Color is used ONLY where it carries semantic meaning. The accent is sage — calm enough for 8+ hour daily use, clearly distinct from both blues and status greens.
- **Scale:** Zinc (true neutral, no blue tint) — same family as Vercel's palette.

### Dark Mode (primary)

| Token | Hex | Zinc | Usage |
|-------|-----|------|-------|
| `--bg` | `#09090b` | zinc-950 | Page background |
| `--surface` | `#18181b` | zinc-900 | Cards, sidebar, panels |
| `--surface-2` | `#27272a` | zinc-800 | Hover, nested surfaces |
| `--surface-3` | `#3f3f46` | zinc-700 | Active states |
| `--border` | `#27272a` | zinc-800 | Dividers, card borders |
| `--border-2` | `#3f3f46` | zinc-700 | Input borders, stronger dividers |
| `--text-1` | `#fafafa` | zinc-50 | Primary text |
| `--text-2` | `#d4d4d8` | zinc-300 | Secondary text |
| `--text-3` | `#a1a1aa` | zinc-400 | Labels, placeholders |
| `--text-4` | `#71717a` | zinc-500 | Disabled, timestamps |

### Light Mode

| Token | Hex | Zinc | Usage |
|-------|-----|------|-------|
| `--bg` | `#ffffff` | white | Page background |
| `--surface` | `#fafafa` | zinc-50 | Cards, panels |
| `--surface-2` | `#f4f4f5` | zinc-100 | Hover states |
| `--surface-3` | `#e4e4e7` | zinc-200 | Active states |
| `--border` | `#f4f4f5` | zinc-100 | Subtle dividers |
| `--border-2` | `#e4e4e7` | zinc-200 | Card borders, inputs |
| `--text-1` | `#09090b` | zinc-950 | Primary text |
| `--text-2` | `#3f3f46` | zinc-700 | Secondary text |
| `--text-3` | `#71717a` | zinc-500 | Labels, placeholders |
| `--text-4` | `#a1a1aa` | zinc-400 | Disabled |

### Sage Accent — Primary Interactive

A single, calm accent. Sage is professional (not playful), natural (not tech-blue), and clearly not a status color. It's the only non-neutral, non-semantic hue in the system.

| Variant | Dark mode | Light mode |
|---------|-----------|------------|
| Accent | `#6aaa84` | `#3d7a5a` |
| Accent muted bg | `rgba(106,170,132,0.12)` | `rgba(61,122,90,0.08)` |
| Accent border | `rgba(106,170,132,0.25)` | `rgba(61,122,90,0.2)` |
| Primary button bg | `#6aaa84` | `#3d7a5a` |
| Primary button text | `#09090b` | `#ffffff` |
| Primary button hover | `#5c9973` | `#2e6347` |
| Focus ring | double-ring: `0 0 0 1px var(--bg), 0 0 0 3px var(--acm)` | same pattern |
| Ghost button text | `--text-2` | `--text-2` |
| Ghost button hover bg | `--surface-2` | `--surface-2` |

Where `--acm` = `#6aaa84` (dark) / `#3d7a5a` (light).

### Semantic (courier status + alerts)

| Token | Hex | Tailwind | Condition / Usage |
|-------|-----|----------|-------------------|
| `--success` | `#22c55e` | green-500 | ping < 30s / completed |
| `--warning` | `#f59e0b` | amber-500 | ping 30s–5min / delayed |
| `--danger` | `#ef4444` | red-500 | ping > 5min / errors |
| `--info` | `#06b6d4` | cyan-500 | Info alerts, new POS orders |

Semantic colors use `rgba(color, 0.1)` backgrounds + `rgba(color, 0.2)` borders for badge/alert backgrounds.

**Rule:** Semantic colors appear ONLY for courier status indicators and system alerts. They do NOT appear on buttons, navigation, or decorative elements. The sage accent is NOT a status color — do not confuse it with `--success`.

### Courier Status Dots (established UX — do not change)

| Status | Color | Condition |
|--------|-------|-----------|
| 🟢 Онлайн | `#22c55e` | ping < 30s |
| 🟡 Фон | `#f59e0b` | ping 30s–5min |
| 🔴 Не відповідає | `#ef4444` | ping > 5min during active delivery |
| ⚫ Офлайн | `#71717a` | no active delivery + ping > 5min |

The 🟢 Онлайн dot uses CSS animation for "alive" feel:
```css
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.5); }
  70%  { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
}
.dot-online { animation: pulse 2s ease-out infinite; }
```

### Card Depth

Cards use a subtle top-edge shine instead of box-shadows (Linear/Raycast pattern):
```css
.card {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
```
This creates depth without visual noise. Do not use `box-shadow` outlines on cards.

### Battery % Color Coding

In courier lists and detail views, battery percentage uses semantic color:
- `> 50%` — `--text-4` (muted, not a concern)
- `20–50%` — `#f59e0b` (amber warning)
- `< 20%` — `#ef4444` (danger red) + ⚠ prefix symbol

---

## Spacing

- **Base unit:** 4px
- **Density:** Compact for data-heavy views, comfortable for forms/modals

| Token | Value | Usage |
|-------|-------|-------|
| `space-0.5` | 2px | Micro gaps |
| `space-1` | 4px | Badge padding, icon margins |
| `space-2` | 8px | Inner padding, small gaps |
| `space-3` | 12px | Standard element gap |
| `space-4` | 16px | Card padding, form spacing |
| `space-5` | 20px | Section internal padding |
| `space-6` | 24px | Card gap, modal padding |
| `space-8` | 32px | Between sections |
| `space-12` | 48px | Page-level breaks |

---

## Layout

| Property | Value |
|----------|-------|
| Max width | 1440px |
| Sidebar width | 220px (collapsed: 52px) |
| Grid | 12 col at ≥1280px |
| Topbar height | 48px |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 4px | Badges, micro chips |
| `rounded` | 6px | Buttons, inputs, tags |
| `rounded-md` | 8px | Cards, dropdowns, menus |
| `rounded-lg` | 12px | Modals, large panels |
| `rounded-full` | 9999px | Avatars, status dots |

**Maximum for cards:** 8px. Never `rounded-2xl` or `rounded-3xl`.

### Depth / Shadows

```css
/* Dark mode */
--shadow-sm: 0 1px 2px rgba(0,0,0,.8);
--shadow-md: 0 4px 16px rgba(0,0,0,.6), 0 1px 3px rgba(0,0,0,.8);
--shadow-lg: 0 8px 32px rgba(0,0,0,.7);

/* Light mode */
--shadow-sm: 0 1px 2px rgba(0,0,0,.05);
--shadow-md: 0 4px 16px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08);
--shadow-lg: 0 8px 32px rgba(0,0,0,.08);
```

---

## Motion

- **Philosophy:** Functional-only. Every animation serves comprehension, never decoration.
- **Duration:** Faster than you think — status changes should feel instant.

| Token | Value | Usage |
|-------|-------|-------|
| micro | 80ms | Hover states, dot color |
| short | 120ms | Focus ring, badge update |
| medium | 180ms | Dropdown, popover |
| long | 250ms | Modal, page transition |

Easing: `ease-out` for enter, `ease-in` for exit.
Never: bounce, spring physics, scroll animations.

---

## Components (shadcn/ui mapping)

| shadcn | Variant | Key customizations |
|--------|---------|-------------------|
| `Button` | default, outline, ghost, destructive | Default = sage bg (dark/light), 6px radius. No colored primary other than sage. |
| `Badge` | + custom: online, background, not_responding, offline | Status colors with muted backgrounds |
| `Table` | — | `py-2.5 px-3` rows, zinc-800 dividers, hover on surface-2, UPPERCASE headers |
| `Input` | — | `bg-bg`, zinc-700 border, sage double-ring focus |
| `Card` | — | `bg-surface`, zinc-800 border, 8px radius, inset shine |
| `Dialog` | — | Centered, max-w-sm/md, `bg-black/70` overlay (rgba(0,0,0,0.72)) |
| `Select` | — | Same as Input, custom SVG chevron |

### Modal Pattern

Backdrop: `rgba(0,0,0,0.72)` — darker than default to keep focus on modal content.
Modal itself: `bg-surface`, 8px radius, `inset 0 1px 0 rgba(255,255,255,0.05)` shine, `--shadow-lg`.

### Toast Notifications

Three semantic variants — each has a left colored bar (4px wide) and an ✕ dismiss button:
- **Success:** left bar `#22c55e`, bg `rgba(34,197,94,0.08)`, border `rgba(34,197,94,0.2)`
- **Error:** left bar `#ef4444`, bg `rgba(239,68,68,0.08)`, border `rgba(239,68,68,0.2)`
- **Info:** left bar `#06b6d4`, bg `rgba(6,182,212,0.08)`, border `rgba(6,182,212,0.2)`

Positioned: bottom-right (desktop), bottom (mobile). Auto-dismiss after 4s. Stack up to 3.

### Command Palette (⌘K)

Triggered by `Cmd+K` / `Ctrl+K`. Dark overlay `rgba(0,0,0,0.6)`, centered modal, search input autofocused.
Results grouped by type (Couriers, Actions). Each result shows icon + label + optional keyboard hint.
Navigation: arrow keys + Enter. Close: Escape.

### Sidebar

- Fixed left, 220px wide (collapsible to 52px icon-only)
- Top: establishment name + switcher caret (for multi-establishment accounts)
- Navigation items with icon + label; active item uses sage left border (3px) + `bg-surface-2`
- Badge (notification count) on items like "Замовлення": small circle, zinc-800 bg, `--text-2` text
- Bottom: courier count, user avatar + name, logout

---

## Dashboard — Map-First Layout

The live map is the hero of the manager dashboard. Layout:

```
┌─────────────────────────────────────────────────────┐
│ Sidebar (220px) │ Topbar (48px)                      │
│                 ├─────────────────────────────────────│
│                 │ Tab bar: Карта / Замовлення / ...   │
│                 ├──────────────────┬──────────────────│
│                 │                  │ Courier list     │
│                 │   Live Map       │ (320px panel)   │
│                 │   (fills rest)   │                 │
│                 │                  │                 │
└─────────────────┴──────────────────┴─────────────────┘
```

### Map Style

Dark tile aesthetic (similar to Mapbox dark theme):
- Background: `#1a1a2e` (deep navy-dark, not zinc — maps have their own palette)
- Roads: `#2d2d44` (subtle, secondary streets even darker)
- Buildings: `#0f0f1a` (near-black)
- Parks/green areas: `#1a2e1a` (very dark green)
- Water: `#0a1628` (deep blue-dark)
- Labels: `#71717a` (zinc-500, minimal)

Courier markers: colored circle with initials, pulsing ring for online status.
Destination pins: numbered (order sequence).

### KPI Cards

Small stat cards above the courier list or in a row below topbar:
- Value: JetBrains Mono, H1 size, `--text-1`
- Label: Caption, `--text-3`
- Trend: SVG sparkline (40px wide, 20px tall), sage for up, danger-muted for down
- No heavy decoration — just number + label + optional sparkline

### Topbar

- Left: page title
- Right: ⌘K search trigger | 🔔 bell with red dot for unread | establishment switcher | avatar
- Live indicator pill: `● LIVE` with `--success` dot and pulse, visible during active deliveries

---

## Mobile App Design Patterns

### Tab Bar (courier app)

4 tabs: Доставки | Маршрут | Статистика | Профіль
- Active tab: sage icon + label
- Inactive: `--text-4` color
- Background: `--surface` with top border `--border`
- Height: 83px (includes safe area on iOS)

### Delivery Proof Screen

Camera viewfinder full-screen with:
- Corner guides rendered in sage (#6aaa84) — 24px L-shaped brackets at each corner
- GPS accuracy indicator (bottom center): `GPS ±8м · 47.8345°N 33.2180°E` — JetBrains Mono, Caption size, `--text-3`
- Geo-match confirmation (when within 300m): sage pill "GPS підтверджено (±42м)"
- Two action buttons below viewfinder:
  - Primary: "Зробити фото і підтвердити" — sage button, full width
  - Secondary ghost: "Підтвердити без фото" — `--text-4`, only if geo_match=true

### Active Delivery Screen

- Persistent notification bar at top: dark surface, order address, ETA
- Mini-map (200px height): shows route and current position
- Three action buttons in sequence (tap to advance state): Прийняв → В дорозі → Доставлено
- Status button uses sage for the current/next action

### GPS Consent Screen

Dark background `#09090b`. Content centered, icon, title, reasons card (`--surface`, 8px radius, `--border`).
Primary button: `#f4f4f5` bg (light button on dark — monochrome exception for consent screens where sage feels out of place).
Denied state: danger-tinted card with "Відкрити налаштування" button.

---

## Tailwind Config

```js
// tailwind.config.ts
export default {
  theme: {
    extend: {
      fontFamily: {
        ui:   ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px',
      },
      colors: {
        acm: {
          DEFAULT: '#6aaa84',
          dark: '#6aaa84',
          light: '#3d7a5a',
          muted: 'rgba(106,170,132,0.12)',
        },
      },
    },
  },
}
```

---

## Do / Don't

| ✅ Do | ❌ Don't |
|-------|------------|
| Zinc neutrals for base (no blue tint) | Slate color scale (blue-tinted) |
| Manrope for all UI text | Onest, Inter, Roboto |
| Sage (`#6aaa84`) for primary interactive | Any blue-adjacent accent (indigo, violet) |
| `font-weight: 700-800` for display text | Thin weights for headers |
| JetBrains Mono for numbers, IDs, coordinates | Regular font for numerical data |
| `border-radius ≤ 8px` for cards | `rounded-2xl`, `rounded-3xl` |
| Negative letter-spacing on headings | Default tracking on large text |
| Status colors ONLY for courier states | Green/red/amber on buttons or nav |
| Compact table rows `py-2.5` | Spacious rows `py-4+` |
| UPPERCASE table headers | Mixed-case `<th>` |
| Double-ring focus (`1px bg + 3px acm`) | Single-color outline-only focus |
| Card inset shine `inset 0 1px 0 rgba(255,255,255,0.05)` | Box-shadow on cards |
| Map as hero / primary content area | Map as decorative background element |
| Sparklines for trend direction on KPIs | Progress bars or plain number-only cards |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|--------------|
| 2026-03-22 | Replaced slate with zinc | Zinc is true neutral with no blue tint — matches Vercel/Apple precision. Slate feels digital-blue, zinc feels material. |
| 2026-03-22 | Replaced Onest with Manrope | Manrope has Apple SF Pro-level quality for Cyrillic. Variable font, excellent weight range, humanist details that improve readability at 13-14px. Mono (Ukrainian bank) aesthetic. |
| 2026-03-22 | Sage accent `#6aaa84` as sole interactive color | "Нічого синього" — no blue. Sage is calm enough for 8h daily use, clearly distinct from status green (#22c55e vivid vs #6aaa84 desaturated), professional, unusual in SaaS space. Replaces earlier attempt at full monochrome which felt too cold. |
| 2026-03-22 | Semantic-only color rule | Green/amber/red appear ONLY for courier status and system alerts. Overusing semantic colors dilutes their meaning — manager must instantly parse status at a glance. Sage accent ≠ status green. |
| 2026-03-22 | Both dark and light modes | Dark is primary (operational command center, evening use), light is for daytime/bright environments. |
| 2026-03-22 | Border-radius max 8px for cards | Sharp-ish corners signal professional tool. Bubbly radius signals toy/consumer app. |
| 2026-03-22 | Negative letter-spacing on headings | Makes Manrope display weights feel tight and premium. Apple uses this consistently. |
| 2026-03-22 | Compact density | Operational tool — managers need maximum data per screen. Spacious = wasted. |
| 2026-03-22 | Card inset shine instead of box-shadow | `inset 0 1px 0 rgba(255,255,255,0.05)` — top-edge highlight used by Linear, Vercel, Raycast. Adds depth without visual noise. |
| 2026-03-22 | Double-ring focus ring | `0 0 0 1px var(--bg), 0 0 0 3px var(--acm)` — same pattern as GitHub, Linear. Accessible and polished. |
| 2026-03-22 | Live pulse animation on 🟢 dot | CSS `@keyframes pulse` on status dot — the dashboard is a real-time tool. Static dots feel dead. |
| 2026-03-22 | Map-first layout | The live courier map is the product's core differentiator. It must be the largest element on screen, not squeezed into a widget. |
| 2026-03-22 | Sparklines on KPI cards | Trend direction matters as much as the current number. SVG polyline, 40×20px, no axes — just direction signal. |
| 2026-03-22 | Toast with left colored bar | Clean semantic variant pattern used by Vercel, Sonner. Better than icon-only or full-color bg. |
| 2026-03-22 | Sage corner guides on delivery proof camera | The camera viewfinder needs affordance — L-shaped sage guides show exactly what area the courier should capture. Clear and functional. |
| 2026-03-22 | Battery % color coding in courier list | Courier battery is operationally critical. Color coding (muted / amber / danger) lets manager spot at-risk couriers instantly without reading numbers. |
| 2026-03-22 | UPPERCASE table headers | ALL CAPS `<th>` with Micro typography and increased letter-spacing — established pattern in data-heavy tools (Linear, Vercel). Increases scanability of column labels. |
