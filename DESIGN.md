# Design System — Weego CMI

## Product Context
- **What this is:** B2B SaaS for managing own couriers at Ukrainian HoReCa establishments
- **Who it's for:** Manager/owner (daily, laptop) + courier (smartphone, on the go)
- **References:** Apple, Vercel, Mono (Ukrainian bank) — refined minimal, premium neutral
- **Anti-references:** Generic blue SaaS, Stripe (mass market), cheap rounded bubbly UI
- **Project type:** Operational dashboard (Next.js 14) + courier mobile app (React Native/Expo)

---

## Aesthetic Direction
- **Direction:** Refined Minimal / Premium Neutral
- **Decoration level:** None — typography and spacing carry all meaning
- **Mood:** Like opening a well-made professional tool. Nothing screams for attention. Everything is exactly where you need it. Vercel's discipline + Apple's warmth.
- **Key rule:** If an element doesn't carry information or enable action — remove it.

---

## Typography

- **Primary UI font:** [Manrope](https://fonts.google.com/specimen/Manrope) — geometric grotesque with humanist touches, excellent native Cyrillic coverage, variable font (300–800 weight axis). Premium feel similar to Apple SF Pro but designed with Cyrillic in mind. Available on Google Fonts.
- **Mono / Data:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — for timestamps, order IDs, delivery counts, battery percentages, any numerical data.
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
| Display | 28–36px | 800 | -0.02em | Page hero, empty states |
| H1 | 20px | 700 | -0.015em | Page titles |
| H2 | 16px | 600 | -0.01em | Section titles, card headers |
| H3 | 14px | 600 | 0 | Subsection labels |
| Body | 14px | 400 | 0 | Descriptions, content |
| Label | 13px | 500 | 0 | Table cells, form values |
| Caption | 12px | 400 | 0 | Secondary info |
| Micro | 11px | 600 | +0.05em | Badges, table headers (uppercase) |
| Mono | 13px | 500 | 0 | Data values, timestamps, IDs |

---

## Color

- **Approach:** Near-monochrome. Color is used ONLY where it carries semantic meaning. Interactive elements are black/white — not colored.
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

### Primary Interactive — Monochrome

No hue-based accent. Interactive elements use zinc extremes — maximally readable, timeless, no color fatigue.

| Variant | Dark mode | Light mode |
|---------|-----------|------------|
| Primary button bg | `#f4f4f5` (zinc-100) | `#18181b` (zinc-900) |
| Primary button text | `#09090b` (zinc-950) | `#fafafa` (zinc-50) |
| Primary button hover | `#e4e4e7` (zinc-200) | `#27272a` (zinc-800) |
| Focus ring | `#fafafa` 2px offset (dark) | `#09090b` 2px offset (light) |
| Ghost button text | `--text-2` | `--text-2` |
| Ghost button hover bg | `--surface-2` | `--surface-2` |

### Semantic (courier status + alerts)

| Token | Hex | Tailwind | Condition / Usage |
|-------|-----|----------|-------------------|
| `--success` | `#22c55e` | green-500 | ping < 30s / completed |
| `--warning` | `#f59e0b` | amber-500 | ping 30s–5min / delayed |
| `--danger` | `#ef4444` | red-500 | ping > 5min / errors |
| `--info` | `#06b6d4` | cyan-500 | Info alerts, new POS orders |

Semantic colors use `rgba(color, 0.1)` backgrounds + `rgba(color, 0.2)` borders for badge/alert backgrounds.

**Rule:** Semantic colors appear ONLY for courier status indicators and system alerts. They do NOT appear on buttons, navigation, or decorative elements.

### Courier Status Dots (established UX — do not change)

| Status | Color | Condition |
|--------|-------|-----------|
| 🟢 Онлайн | `#22c55e` | ping < 30s |
| 🟡 Фон | `#f59e0b` | ping 30s–5min |
| 🔴 Не відповідає | `#ef4444` | ping > 5min during active delivery |
| ⚫ Офлайн | `#71717a` | no active delivery + ping > 5min |

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
| `Button` | default, outline, ghost, destructive | Default = near-white bg (dark) / near-black bg (light), 6px radius. No colored primary. |
| `Badge` | + custom: online, background, not_responding, offline | Status colors with muted backgrounds |
| `Table` | — | `py-2.5 px-3` rows, zinc-800 dividers, hover on surface-2 |
| `Input` | — | `bg-bg`, zinc-700 border, zinc focus ring (no color) |
| `Card` | — | `bg-surface`, zinc-800 border, 8px radius |
| `Dialog` | — | Centered, max-w-sm/md, `bg-black/60` overlay |
| `Select` | — | Same as Input |

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
    },
  },
}
```

---

## Do / Don't

| ✅ Do | ❌ Don't |
|-------|---------|
| Zinc neutrals for base (no blue tint) | Slate color scale (blue-tinted) |
| Manrope for all UI text | Onest, Inter, Roboto |
| Near-white/near-black for primary buttons | Any hue-based accent color |
| `font-weight: 700-800` for display text | Thin weights for headers |
| JetBrains Mono for numbers, IDs | Regular font for numerical data |
| `border-radius ≤ 8px` for cards | `rounded-2xl`, `rounded-3xl` |
| Negative letter-spacing on headings | Default tracking on large text |
| Status colors only for courier states | Green/red/amber for any other UI purpose |
| Compact table rows `py-2.5` | Spacious rows `py-4+` |
| Color only where it carries meaning | Decorative color |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-22 | Replaced slate with zinc | Zinc is true neutral with no blue tint — matches Vercel/Apple precision. Slate feels digital-blue, zinc feels material. |
| 2026-03-22 | Replaced Onest with Manrope | Manrope has Apple SF Pro-level quality for Cyrillic. Variable font, excellent weight range, humanist details that improve readability at 13-14px. Mono (Ukrainian bank) aesthetic. |
| 2026-03-22 | Removed all hue-based accent | "Нічого синього" — no blue, no blue-adjacent (indigo, violet, purple). Monochrome interactive elements (near-white dark / near-black light) match Vercel's discipline and never cause color fatigue for all-day operational use. |
| 2026-03-22 | Semantic-only color rule | Green/amber/red appear ONLY for courier status and system alerts. Overusing semantic colors dilutes their meaning — manager must instantly parse status at a glance. |
| 2026-03-22 | Both dark and light modes | Dark is primary (operational command center, evening use), light is for daytime/bright environments. Monochrome approach works perfectly in both without needing separate accent colors. |
| 2026-03-22 | Border-radius max 8px for cards | Sharp-ish corners signal professional tool. Bubbly radius signals toy/consumer app. |
| 2026-03-22 | Negative letter-spacing on headings | Makes Manrope display weights feel tight and premium. Apple uses this consistently. |
| 2026-03-22 | Compact density | Operational tool — managers need maximum data per screen. Spacious = wasted. |
