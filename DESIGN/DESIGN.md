# Design System — Weego CMI

## Product Context

- **What this is:** B2B SaaS for managing own couriers at Ukrainian HoReCa establishments
- **Who it's for:** Manager/owner (8–12h daily, laptop) + courier (smartphone, on the go)
- **Project type:** Operational dashboard (Next.js 14) + courier mobile app (React Native/Expo)

---

## Atmosphere

> **The feeling:** a warm dispatch room late at night. Dim lighting, everything in its place. The screen doesn't glare, doesn't press, doesn't demand attention — it quietly shows the state of things. When something needs action, you see it instantly. The rest of the time, the interface simply… exists. Like a well-designed cockpit: everything at hand, nothing extra.

- **Direction:** Warm Operational Calm
- **Mood:** Quiet confidence. A professional tool that feels like it was made for someone who stares at it for 12 hours. Not cold precision (Vercel), not flashy (generic SaaS) — warm, restrained, grounded.
- **References:** Warp (warm dark atmosphere), ElevenLabs (refined shadow layering), Ollama (radical restraint), Apple (single-accent discipline)
- **Anti-references:** Colorful dashboards, blue SaaS, bubbly UI, anything that fights for attention
- **Key rule:** If an element doesn't carry information or enable action — remove it. If it can be neutral — it must be neutral. Color is a scarce resource.

---

## The Quiet Screen Principle

This is the most important rule in the entire design system. It overrides every other guideline when they conflict.

**Rule: at any moment, the visible screen area should be 90%+ warm neutral.** Only a handful of small colored elements (status dots, one alert border) should break the monochrome calm. If you count more than 5 chromatic (non-neutral) elements visible simultaneously — something is wrong.

**Why:** The manager stares at this screen for 8–12 hours. Every colored element competes for attention. When everything is colored, nothing stands out. When almost everything is neutral, the one red dot SCREAMS — which is exactly what you want for "courier not responding."

**The hierarchy of attention:**
1. **Normal operation (95% of time):** Screen is warm neutral. Manager scans data peacefully. Small status dots show courier health at a glance.
2. **Attention needed:** An alert card appears with a thin colored left border. Eye goes there naturally.
3. **Critical:** Alert card + courier marker pulses on the map. Manager acts.

The interface is quiet by default and loud only when it must be.

---

## Color

### Philosophy

Near-monochrome warm base. A single calm accent (sage) for interactive elements. Semantic colors (green/amber/red) exist ONLY as tiny indicators — dots, thin borders, micro-tints. Color is never decorative.

The palette is intentionally warm — not cold neutral zinc, but warm-shifted grays with a subtle earthy undertone. The warmth is barely perceptible in hex values but makes a fundamental difference after 4+ hours of use.

### Warm Neutral Base — Dark Mode (primary)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0c0b09` | Page background — warm near-black |
| `--surface` | `#1a1917` | Cards, sidebar, panels |
| `--surface-2` | `#252420` | Hover states, nested surfaces |
| `--surface-3` | `#3a3935` | Active states, pressed |
| `--border` | `rgba(250,249,246,0.08)` | Dividers, card borders — semi-transparent, soft |
| `--border-2` | `rgba(250,249,246,0.14)` | Input borders, stronger dividers |
| `--text-1` | `#faf9f6` | Primary text — warm parchment, NOT pure white |
| `--text-2` | `#d5d4ce` | Secondary text |
| `--text-3` | `#9c9b96` | Labels, placeholders |
| `--text-4` | `#6b6a66` | Disabled, timestamps, table headers |

**Why warm parchment (`#faf9f6`) instead of pure white (`#fafafa`):** Pure white on a dark background creates harsh contrast that strains eyes over hours. The warm parchment has a barely-perceptible cream tint that softens the reading experience. The difference is invisible consciously but felt after extended use.

**Why semi-transparent borders:** Hard hex borders (`#27272a`) create rigid lines. Semi-transparent borders (`rgba(250,249,246,0.08)`) adapt to any surface and create ghostly, soft containment — like looking through frosted glass. Borders should be felt, not seen.

### Warm Neutral Base — Light Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#faf9f6` | Page background — warm white |
| `--surface` | `#f3f2ee` | Cards, panels |
| `--surface-2` | `#ebeae6` | Hover states |
| `--surface-3` | `#dddcd8` | Active states |
| `--border` | `rgba(26,25,24,0.07)` | Dividers — semi-transparent |
| `--border-2` | `rgba(26,25,24,0.13)` | Input borders, stronger dividers |
| `--text-1` | `#1a1918` | Primary text |
| `--text-2` | `#454340` | Secondary text |
| `--text-3` | `#7a7874` | Labels, placeholders |
| `--text-4` | `#a5a39f` | Disabled |

### Interactive States — neutral elevation

No hue. Interactive states are expressed through **surface elevation**, not color. The interface has zero chromatic accent — only warm neutral surfaces and the three semantic signals (green/amber/red).

Why: Any accent color, even a muted one, competes with semantic signals over time. If sage green is used for buttons AND green dots mean "online," the brain learns to partially ignore green. Removing the accent entirely sharpens the meaning of the semantic colors.

| Variant | Value |
|---------|-------|
| `--acm` (primary btn bg) | `#3a3935` (`--surface-3`) |
| `--acm-h` (hover) | `#47463f` |
| `--acm-m` (active nav bg) | `rgba(250,249,246,0.05)` |
| `--acm-b` (active nav border / btn border) | `rgba(250,249,246,0.16)` |
| Primary button text | `--text-1` (`#faf9f6`) |
| Ghost button text | `--text-2` |
| Ghost button hover bg | `--surface-2` |
| Focus ring | `0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)` |

### Semantic Signals — STRICTLY RESTRICTED

Semantic colors exist for one purpose: instant courier status recognition. They are confined to the smallest possible visual elements. Breaking these restrictions is the #1 way to destroy the calm of the interface.

| Token | Hex | ALLOWED usage |
|-------|-----|---------------|
| `--ok` | `#22c55e` | Status dots (6–8px), toast left border (3px) |
| `--warn` | `#eab308` | Status dots, toast left border, delivery timer pill |
| `--bad` | `#ef4444` | Status dots, alert left border (3px), critical row tint |

**Muted tint variants** (for subtle backgrounds):

| Variant | Value | Max usage |
|---------|-------|-----------|
| `--ok-tint` | `rgba(34,197,94,0.04)` | Toast/badge background |
| `--ok-border` | `rgba(34,197,94,0.10)` | Toast/badge border |
| `--warn-tint` | `rgba(234,179,8,0.04)` | Toast/timer background |
| `--warn-border` | `rgba(234,179,8,0.10)` | Toast/timer border |
| `--bad-tint` | `rgba(239,68,68,0.03)` | Alert row background, critical card |
| `--bad-border` | `rgba(239,68,68,0.10)` | Alert card border |

Note the extremely low opacities: 0.03–0.04 for backgrounds, 0.10 for borders. These should be barely perceptible — a whisper of color, not a shout.

### Color Budget Rule

**Allowed semantic color surfaces:**

| Surface | Max size | Example |
|---------|----------|---------|
| Status dot | 6–8px circle | Courier status in table, sidebar |
| Left border on card | 3px × card height | Alert card, toast notification |
| Background tint on row/card | full row, 0.03 opacity | Danger courier row in table |
| Map marker fill | 16–28px circle | Courier markers on map |

**FORBIDDEN semantic color surfaces:**

| Surface | Why forbidden |
|---------|---------------|
| Badge/pill fill | Colored pills ("В дорозі", "Прийнято") create noise. Use neutral text instead. |
| Text color | NEVER color text semantically. Use a dot + neutral text. "Андрій Шевченко" is `--text-1`, not red. |
| Button fill | "Нагадати" is a ghost button in `--text-2`, not a red button. |
| Section header color | "ОЧІКУЮТЬ ПРИЗНАЧЕННЯ" is `--text-4` uppercase, not sage/green. |
| KPI card accents | KPI cards are uniform neutral. No colored top borders, no colored numbers. |
| Trend arrows/text | "↑ +1 від вчора" is `--text-3`, not green/red. Arrow direction tells the story. |
| Timer/counter badges | "8хв" waiting time is `--text-3` in JetBrains Mono. Not an amber badge. |
| Sparklines | `--text-4` (very muted). Not sage or semantic color. |

**The test:** Take a screenshot. Convert it to grayscale. If you can't identify which elements were colored — you have too much color. Colored elements should be few enough to list by name.

### Courier Status Dots

| Status | Dot color | Condition |
|--------|-----------|-----------|
| Онлайн | `#22c55e` | ping < 30s |
| Фон | `#eab308` | ping 30s–5min |
| Не відповідає | `#ef4444` | ping > 5min during active delivery |
| Офлайн | `#6b6a66` (`--text-4`) | no active delivery + ping > 5min |

Dots are 6px in tables/lists, 8px in the sidebar courier list. Static — no animation (animation is for map markers only).

### Battery % Display

In courier lists: JetBrains Mono, `--text-4` color by default. Color coding only at thresholds:
- `> 50%` — `--text-4` (muted, no concern)
- `20–50%` — `#eab308` (amber text only — no badge, no background)
- `< 20%` — `#ef4444` (red text) + `⚠` prefix

### "No Info Color" Rule

The system has NO dedicated info/cyan color. The previous `#06b6d4` (cyan-500) is removed. Informational states (new POS orders, system messages) use sage muted tint or plain neutral styling. Three semantic colors maximum: green, amber, red. Adding more dilutes their meaning.

---

## Typography

- **Primary UI font:** [Manrope](https://fonts.google.com/specimen/Manrope) — geometric grotesque with humanist touches, excellent native Cyrillic coverage, variable font. Premium feel similar to Apple SF Pro but designed with Cyrillic in mind.
- **Mono / Data:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — for timestamps, order IDs, delivery counts, battery %, coordinates, ETAs, any numerical data.
- **Loading:** `display=swap` + `preconnect`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

```css
body { font-family: 'Manrope', system-ui, sans-serif; }
.mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: "tnum"; }
```

Note: weights loaded are 400, 500, 600 only. No 700 or 800. This is intentional — see weight philosophy below.

### Type Scale

| Level | Size | Weight | Tracking | Usage |
|-------|------|--------|----------|-------|
| Display | 28–36px | 600 | -0.03em | Page hero titles, empty states |
| H1 | 20px | 600 | -0.02em | Page titles |
| H2 | 16px | 500 | -0.01em | Section titles, card headers |
| H3 | 14px | 500 | 0 | Subsection labels |
| Body | 14px | 400 | -0.006em | Descriptions, content |
| Label | 13px | 500 | 0 | Table cells, form values |
| Caption | 12px | 400 | 0 | Secondary info |
| Micro | 11px | 500 | +0.05em | Badges, table headers (UPPERCASE) |
| Mono | 13px | 500 | 0 | Data values, timestamps, IDs, ETAs |

Table headers (`<th>`) are always UPPERCASE, Micro size, letter-spacing +0.05em, `--text-4` color.

### Weight Philosophy

**Maximum weight in the system: 600.** No 700, no 800, never bold. This is the single most impactful change for visual calm.

Why: weight = volume. Heavier text shouts louder. A display heading at 800 weight SCREAMS at you every time your eyes pass over it. At 600, it speaks confidently but doesn't demand attention. Over 8 hours, this difference is the difference between fatigue and comfort.

Hierarchy is achieved through **size and spacing**, not weight. Display (36px/600) is clearly more prominent than H1 (20px/600) — the size difference is sufficient. Adding weight contrast on top is redundant and noisy.

The only place weight 600 appears above body text is in headings, buttons, and emphasis. Body text is 400 (regular), labels are 500 (medium). This creates a calm, even typographic texture where nothing fights for attention.

### Negative Letter-Spacing

Apply subtle negative tracking at all sizes (Apple approach):

| Size | Tracking | Rationale |
|------|----------|-----------|
| 28–36px | -0.03em | Tight, confident display |
| 20px | -0.02em | Headings feel composed |
| 16px | -0.01em | Subtly tighter than default |
| 14px | -0.006em | Barely perceptible, but improves cohesion |
| 13px | 0 | Labels stay default |
| 11–12px | 0 or +0.05em (UPPERCASE) | Micro text needs room |

---

## Spacing

- **Base unit:** 4px
- **Density:** Compact for tables, comfortable for forms/modals/mobile

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

Maximum for cards: 8px. Never `rounded-2xl` or `rounded-3xl`.

---

## Shadows & Depth

### Philosophy

Shadows are layered, low-opacity, and warm-tinted. Surfaces should feel like they "barely exist" — floating just above the background with the lightest possible touch. Heavy shadows (>0.4 opacity in dark mode) are forbidden.

The system borrows from ElevenLabs: multi-layer shadow stacks where each layer serves a purpose (edge definition + containment + elevation). The warm text color (`#faf9f6`) subtly tints the edge highlights, connecting shadows to the warm palette.

### Shadow Scale — Dark Mode

```css
/* Level 0.5 — Edge definition: subtle top-edge highlight on cards */
--shadow-edge: inset 0 0.5px 0 rgba(250,249,246,0.05);

/* Level 1 — Subtle containment: outline ring + micro lift */
--shadow-sm: 0 0 0 0.5px rgba(250,249,246,0.04),
             0 1px 2px rgba(0,0,0,0.25);

/* Level 2 — Card elevation: edge + containment + lift */
--shadow-md: inset 0 0.5px 0 rgba(250,249,246,0.05),
             0 0 0 0.5px rgba(250,249,246,0.04),
             0 2px 8px rgba(0,0,0,0.30);

/* Level 3 — Float: dropdowns, modals, popovers */
--shadow-lg: 0 4px 24px rgba(0,0,0,0.40),
             0 0 0 0.5px rgba(250,249,246,0.06);
```

### Shadow Scale — Light Mode

```css
--shadow-edge: inset 0 0.5px 0 rgba(255,255,255,0.7);
--shadow-sm: 0 0 0 0.5px rgba(0,0,0,0.04),
             0 1px 2px rgba(0,0,0,0.04);
--shadow-md: inset 0 0.5px 0 rgba(255,255,255,0.7),
             0 0 0 0.5px rgba(0,0,0,0.04),
             0 2px 8px rgba(0,0,0,0.06);
--shadow-lg: 0 4px 24px rgba(0,0,0,0.10),
             0 0 0 0.5px rgba(0,0,0,0.06);
```

### Card Depth

Cards use `--shadow-edge` (inset top-edge highlight) + border `--border`. No `box-shadow` outlines. No heavy elevation.

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-edge);
}
```

---

## Motion

- **Philosophy:** Functional-only. Every animation serves comprehension, never decoration.
- **Duration:** Faster than you think — status changes should feel instant.

| Token | Value | Usage |
|-------|-------|-------|
| micro | 80ms | Hover states, dot color |
| short | 120ms | Focus ring, badge update |
| medium | 180ms | Dropdown, popover, marker appear |
| long | 250ms | Modal, page transition |

Easing: `ease-out` for enter, `ease-in` for exit.
Never: bounce, spring physics, scroll animations, decorative transitions.

---

## Components (shadcn/ui mapping)

| shadcn | Variant | Key customizations |
|--------|---------|-------------------|
| `Button` | default, outline, ghost, destructive | Default = sage bg, 6px radius. Ghost = `--text-2` text, `--surface-2` hover bg. No colored destructive — use ghost + confirmation dialog. |
| `Badge` | neutral only | `--surface-2` bg, `--text-3` text, 4px radius. NO colored badges. Status is shown by a dot prefix, not a badge fill. |
| `Table` | — | `py-2.5 px-3` rows, `--border` dividers, hover `--surface-2`, UPPERCASE headers (`--text-4`, Micro) |
| `Input` | — | `var(--bg)` background, `--border-2` border, sage double-ring focus |
| `Card` | — | `var(--surface)` bg, `--border` border, 8px radius, `--shadow-edge` |
| `Dialog` | — | Centered, max-w-sm/md, `rgba(0,0,0,0.72)` overlay |
| `Select` | — | Same as Input, custom SVG chevron |

### Status Display in Tables

Courier/delivery status in tables uses **dot + neutral text**, never colored badges:

```
● Дмитро Коваль    #4819    вул. Саксаганського 23    В дорозі    ~12хв
● Олена Мороз      #4820    просп. Перемоги 8         Прийнято    ~25хв
● Андрій Шевченко  #4817    вул. Лесі Українки 48     Не відповідає    7хв
```

- `●` — 6px status dot (green/amber/red/gray)
- Courier name — always `--text-1`, never colored
- Status text — always `--text-3`, never colored
- ETA — `--text-2`, JetBrains Mono, never colored
- Danger rows — entire row gets `--bad-tint` (0.03 opacity) background. That's the only additional signal.

### Alert Card Pattern

When a courier needs attention (not responding, ETA overdue):

```css
.alert-card {
  background: var(--bad-tint);     /* rgba(239,68,68,0.03) */
  border: 1px solid var(--border);
  border-left: 3px solid #ef4444;  /* thin left accent — the ONLY strong color */
  border-radius: 8px;
  padding: 12px 16px;
}
.alert-card .title { color: var(--text-1); font-weight: 500; }
.alert-card .detail { color: var(--text-3); }
.alert-card .action-btn { /* ghost button, --text-2, no color */ }
```

The thin left border is the sole colored element. Title, details, and action buttons are all neutral. The alert stands out through its POSITION (above the main content) and the left border, not through color overload.

### KPI Cards

Small stat cards above the main content area:

```css
.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-edge);
  padding: 16px;
}
```

- Value: JetBrains Mono, H1 size (20px/600), `--text-1`
- Label: Caption (12px/400), `--text-3`
- Trend: Caption, `--text-4` — direction only ("= як вчора", "↑ +1 від вчора")
- Sparkline: SVG polyline, 40×20px, `--text-4` stroke (very muted). No color.
- Sub-text (like "3 в дорозі · 1 вільний · 1 не вийшли"): Caption, `--text-4`

**All KPI cards are visually identical.** No colored top borders, no colored numbers, no colored sparklines. The data speaks for itself. If something needs the manager's attention, the alert card below handles it — not the KPI card.

### Pending Assignments Section

The "ОЧІКУЮТЬ ПРИЗНАЧЕННЯ" section:

- Section header: "ОЧІКУЮТЬ ПРИЗНАЧЕННЯ" — Micro, UPPERCASE, `--text-4`, letter-spacing +0.05em. NOT sage, NOT green.
- Count badge: "(N)" or "N замовлень" — `--text-4`
- Order row: order # in JetBrains Mono (`--text-2`), address in `--text-2`, source in `--text-4`
- Waiting time: JetBrains Mono, `--text-3`. NOT a colored badge. Just "8хв" as text.
- "Призначити" button: primary button (`--surface-3` bg, `--text-1` text, `rgba(250,249,246,0.16)` border)

### Toast Notifications

Three semantic variants — thin left colored bar (3px) + neutral content + ✕ dismiss:

- **Success:** left bar `#22c55e`, bg `--ok-tint`, border `--ok-border`
- **Error:** left bar `#ef4444`, bg `--bad-tint`, border `--bad-border`
- **Warning:** left bar `#eab308`, bg `--warn-tint`, border `--warn-border`

Text inside toasts is always `--text-1` (title) and `--text-3` (body). Never colored text.

Positioned: bottom-right (desktop), bottom (mobile). Auto-dismiss after 4s. Stack up to 3.

### LIVE Indicator

Small pill in topbar: 6px green dot (`#22c55e`) + "LIVE" text in `--text-3` (NOT green text). Dot pulses subtly during active deliveries. Visible only when there are active deliveries.

### Modal Pattern

Backdrop: `rgba(0,0,0,0.72)`. Modal: `var(--surface)` bg, 8px radius, `--shadow-lg`, `--shadow-edge`.

### Command Palette (⌘K)

Triggered by `Cmd+K` / `Ctrl+K`. Dark overlay `rgba(0,0,0,0.60)`, centered modal, search input autofocused. Results grouped by type. Navigation: arrow keys + Enter. Close: Escape.

### Sidebar

- Fixed left, 220px wide (collapsible to 52px icon-only)
- Top: establishment name + switcher caret
- Navigation items with icon + label; active item: `rgba(250,249,246,0.16)` left border (2px) + `--acm-m` background + `--text-1` text
- Badge (count) on items: `--surface-3` bg, `--text-2` text, 4px radius. NOT colored.
- Bottom: courier count, user avatar + name, logout

### Interface States

- **Empty state:** Text only + optional ghost action button. No illustrations, no emoji. Title in `--text-2`, subtitle in `--text-4`. Restrained.
- **Loading:** Skeleton shimmer using `--surface-2`. Never spinners (they attract attention to the loading instead of the content). Shimmer duration: 1.5s, ease-in-out.
- **Error state:** `--bad-tint` background card with `--bad-border` border. Text in `--text-1` / `--text-3`. Never a full-red banner.

---

## Dashboard Layout (Main Page)

The main dashboard is **info-first** — the map is a dedicated `/map` page. Splitting concerns lets the manager parse operational status immediately without the visual noise of the map.

```
┌────────────────────────────────────────────────────────────┐
│ Sidebar (220px) │ Topbar (48px) — title, LIVE pill, ⌘K   │
│                 ├────────────────────────────────────────────│
│                 │ KPI row: Active / Pending / On shift / Avg│
│                 ├────────────────────────────────────────────│
│                 │ Alert card (if any — thin red left border) │
│                 ├──────────────────────┬─────────────────────│
│                 │ Pending assignments  │ Courier status panel│
│                 │ (unassigned orders)  │ (right, 300px)      │
│                 ├──────────────────────┤                     │
│                 │ Active deliveries    │                     │
│                 │ table                │                     │
└─────────────────┴──────────────────────┴────────────────────┘
```

### Topbar

- Left: page title (`--text-1`, H1)
- Center: tab-style navigation: "Дашборд" / "/map — Жива карта" (`--text-1` active, `--text-3` inactive)
- Right: ⌘K search trigger (ghost) | 🔔 bell (tiny red dot for unread, otherwise neutral) | avatar

---

## Map Page (/map)

Separate route — full-screen operational map.

```
┌────────────────────────────────────────────────────────────┐
│ Sidebar (220px) │ Map topbar: title, LIVE, filter buttons  │
│                 ├──────────────────────┬─────────────────────│
│                 │                      │ Courier list panel  │
│                 │  Leaflet map         │ (300px) — scrollable│
│                 │  (fills rest)        │ click → select      │
│                 │                      │                     │
│                 │  [legend bottom-left]│ [Assign / Details]  │
└─────────────────┴──────────────────────┴────────────────────┘
```

### Map Tiles

**Library:** [Leaflet.js](https://leafletjs.com/) v1.9.x (free, no API key).
**Tile provider:** CartoDB Dark Matter — matches the warm dark background.

```
https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
subdomains: 'abcd'
attribution: © OpenStreetMap © CARTO
maxZoom: 19
```

No Google Maps, no Mapbox (paid API keys required).

### Courier Markers

Circle `DivIcon` with courier initials — no badge, no emoji, no transport icon on the marker.

```
Size: zoom≥14 → 28px | zoom≥12 → 21px | zoom<12 → 16px
Background: status color (green/amber/red/gray)
Text: courier initials, Manrope 600, dark on light colors / white on red
Border: 1.5px rgba(255,255,255,.12) | selected: 2.5px rgba(255,255,255,.45)
```

**Map markers are the ONE place where status colors appear at larger scale.** This is acceptable because the map IS a spatial status display — its purpose is to show where couriers are and what state they're in. The Quiet Screen Principle allows this exception for the map view specifically.

**Marker animation — pulse only where attention is needed:**

| Status | Animation | Duration | Glow color |
|--------|-----------|----------|------------|
| 🔴 Danger | Fast urgent pulse | 1.4s | `rgba(239,68,68,.55)` |
| 🟡 Background | Slow subtle pulse | 3.5s | `rgba(234,179,8,.35)` |
| 🟢 Online | **Static — no animation** | — | — |
| ⚫ Offline | Static, `opacity: 0.5` | — | — |

Pulsing "all good" is noise. Pulsing danger draws the manager's eye to what needs action.

```css
@keyframes courier-glow-danger {
  0%   { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 0    rgba(239,68,68,.55) }
  60%  { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 12px  rgba(239,68,68,0) }
  100% { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 0     rgba(239,68,68,0) }
}
@keyframes courier-glow-bg {
  0%   { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 0   rgba(234,179,8,.35) }
  55%  { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 9px  rgba(234,179,8,0) }
  100% { box-shadow: 0 2px 10px rgba(0,0,0,.6), 0 0 0 0    rgba(234,179,8,0) }
}
```

### Establishment Marker

Sage-bordered circle (32px) with SVG building icon. Tooltip with establishment name. `zIndexOffset: 500` (below couriers).

### Destination Markers

Order number in a `--surface-2` circle with status-dot prefix, connected to ground with 2px stem. Hidden by default — visible only when that courier's route is shown. Smooth `opacity` transition (180ms).

### Route-on-Select Pattern

Routes are **hidden by default**. Clicking a courier marker or panel item:
1. Hides all existing routes + destination markers
2. Fetches the real road route from OSRM
3. Shows route as animated dashed polyline + destination marker
4. Map pans/zooms to fit courier → destination (padding 70px, maxZoom 15)
5. Clicking map background deselects → hides route

Animated route line:
```css
.route-active {
  stroke: var(--acm);  /* neutral elevated surface — not status-colored */
  stroke-dasharray: 12, 8;
  animation: march 1.4s linear infinite;
}
@keyframes march { to { stroke-dashoffset: -20 } }
```

**Route color is always `--acm` (neutral warm surface)**, not courier status color. The courier marker already shows status. Coloring the route too creates redundant noise.

### OSRM Routing (Real ETA)

**Service:** [OSRM](http://project-osrm.org/) public demo server — free, real road routing, GeoJSON geometry + duration.

```
Base URL: https://router.project-osrm.org/route/v1/{profile}/{lng},{lat};{destLng},{destLat}
          ?overview=full&geometries=geojson
```

| Transport type | OSRM profile |
|----------------|-------------|
| car | `driving` |
| moto | `driving` |
| bike | `cycling` |
| foot | `foot` |

ETA: `Math.ceil(data.routes[0].duration / 60)` minutes. Displayed as `~N хв` or `~N.N год`. Cached per courier ID for the session.

Fallback: OSRM failure → straight-line polyline. No ETA in fallback.

Route geometry: `data.routes[0].geometry.coordinates` → convert `[lng, lat]` to `[lat, lng]` for Leaflet.

### Map Right Panel

300px fixed-width panel. Courier list items show:
- Status dot (6px) + name (`--text-1`) — name is NEVER colored, even for danger state
- Battery % in JetBrains Mono with threshold color coding (see Battery % Display)
- Current order # + address (JetBrains Mono, `--text-3`)
- Transport type: text label in `--text-4` (no emoji, no colored badge)
- ETA: JetBrains Mono, `--text-2`. NOT colored by status.
- "Нагадати" button for danger-state couriers: **ghost button** in `--text-2`, NOT red
- Offline couriers: `opacity: 0.45`, at bottom of list

Selected courier: `rgba(250,249,246,0.16)` left border (2px) + `--surface-2` bg.

Danger courier row: `--bad-tint` (0.03 opacity) background. Subtle, not aggressive.

---

## Mobile App Design Patterns

### Tab Bar (courier app)

4 tabs: Доставки | Маршрут | Статистика | Профіль
- Active tab: `--text-1` icon + label
- Inactive: `--text-4` color
- Background: `--surface` with top border `--border`
- Height: 83px (includes safe area on iOS)

### Deliveries Screen (Home Tab)

Two modes controlled by `establishments.dispatch_mode` setting:

**Mode A — Тільки менеджер (`dispatch_mode: 'manual'`, default):**
- Courier sees ONLY orders the manager explicitly assigned to them
- Section "Призначено менеджером (N)"
- CTA: "Розпочати доставку →" (ghost button: `--surface-2` bg, `--text-2` text)
- Empty state: "Очікуємо наступне від менеджера"

**Mode B — Менеджер + курʼєр (`dispatch_mode: 'recommend'` or `'auto'`):**
- Manager can still assign orders to specific couriers
- Additionally, courier sees a pool of unassigned orders they can pick
- Section "Доступні замовлення (N)" — unassigned pool
- Order card CTA: "Прийняти замовлення" (primary button: `--surface-3` bg, `--text-1` text)
- One active delivery at a time

Completed deliveries: "Виконано сьогодні (N)" — minimal rows with order # + address + time.

### Active Delivery Screen

Block-style card layout — each section is a distinct `--surface` card with `--border` and 8px radius.

**Block 1 — Map card:**
- Leaflet map, 230px height, CartoDB Dark Matter tiles
- Footer row: left = "X км · ~N хв" (13px/500, `--text-2`), right = "Відкрити в навігаторі →" (`--text-1`, 12px/600)
- Route: neutral dashed polyline (`--acm`), courier marker, destination marker

**Block 2 — Customer card:**
- Header: customer name (15px/600, `--text-1`) + "Зателефонувати" button (ghost: `--surface-2` bg, `--text-2` text, small)
- Address: 13px/500, `--text-2`; apartment/floor/intercom below (12px, `--text-4`)
- Comment block (if present): `--warn-tint` bg, `--warn-border` border, 💬 icon. Comment text in `--text-2` (not amber text).

**Delivery timer (top right of nav header, only if `delivery_sla_minutes` is set):**
- Shows remaining time: "залишилось 42 хв"
- Single pill: 12px/600, Manrope
- Default: `--warn-tint` bg, `--warn-border` border, `--text-2` text, 6px radius
- When ≤ 10 хв: switch to `--bad-tint` bg, `--bad-border` border
- Hidden when `delivery_sla_minutes = null`
- Never show "SLA" — courier-facing language is plain Ukrainian

**Block 3 — Payment card:**
- Header: "СПОСІБ ОПЛАТИ" (11px/500, uppercase, `--text-4`, `letter-spacing:.05em`)
- Payment method: card icon (`--text-3`) + method text (14px/500, `--text-1`)
- Terminal warning (ONLY for terminal payment): `--bad-tint` bg, `--bad-border` border, 6px radius, warning icon + "Не забудьте взяти термінал" (13px/600, `--text-2`)

**Block 4 — Actions (no card bg):**
- Primary: "Підтвердити доставку →" — primary button (`--surface-3` bg, `--text-1` text), full width, 16px/600
- Secondary ghost: "Звʼязатись з менеджером" — `--border-2` border, `--text-3`

**Navigation bottom sheet** (triggered by "Відкрити в навігаторі"):
- iOS: Shows installed apps (Google Maps, Apple Maps, Waze, 2GIS, HERE WeGo via `canOpenURL()`)
- Android: `geo:lat,lng` intent → OS shows system app picker
- Standard bottom sheet: handle, dark overlay, "Скасувати" button

**Manager contact bottom sheet:**
- Always: phone call
- Optional: Telegram, Viber (if configured)
- Each row: muted icon (`--text-3`) + label + detail + chevron

### Delivery Proof Screen

Triggered from "Підтвердити доставку →". Full-screen flow.

**Header:** Back arrow only (no ✕ — one navigation action).

**Block 1 — GPS hero card:**
- Leaflet map, 200px height, zoom 17, CartoDB Dark Matter
- Accuracy circle: `rgba(250,249,246,0.04)` fill, `rgba(250,249,246,0.12)` stroke
- Courier marker: `--surface-3` filled circle with initials
- Footer: `"GPS активний · точність ±Nm"` (pulsing `--ok` dot + `--text-3`) + coordinates in JetBrains Mono right-aligned
- Geo-match row — two states:
  - **Match:** `--ok` dot + "GPS підтверджено" (13px/600, `--text-2`) + "±Nм від адреси" (JetBrains Mono, `--text-2`)
  - **Fail:** `--text-3` dot + "GPS не підтверджено" (13px/600, `--text-3`) + "±Nм від адреси" (JetBrains Mono, `--text-3`)
- **Geo-match NEVER blocks delivery confirmation** — GPS spoofing by ZSU is real in Ukraine. Couriers must always be able to complete delivery.
- **Fail state — optional note block:**
  - `--bad-tint` bg, `--bad-border` border, 8px radius
  - Header: pencil icon + "ПРИЧИНА" (uppercase, 11px/500, `--text-4`) + "необовʼязково" (10px, `--text-4`)
  - Textarea: transparent bg, 13px, `--text-2`
  - Optional — courier can submit without it
- Address recap: "АДРЕСА ДОСТАВКИ" (uppercase, 11px, `--text-4`) + address (14px/500, `--text-2`)

**Block 2 — Photo option:**
- Camera icon + "Фото підтвердження" (13px/500, `--text-2`) + "Якщо залишаєте без особистої передачі" (11px, `--text-4`)
- "Зробити фото" ghost button
- Photo is never required. GPS is the primary proof in Ukraine.

**CTA:** "Завершити доставку" — primary button (`--surface-3` bg, `--text-1` text), full width, 16px/600.

**Tab bar:** "Маршрут" tab shows Active Delivery when delivery is active; empty state otherwise.

### Statistics Screen

Tab "Статистика". Period selector (Тиждень / Місяць) — pill-style toggles.

**Hero summary card** — full-width, three equal columns (separated by `--border` vertical lines):
- Value: JetBrains Mono, 24px/600, `--text-1`
- Label: 11px/500, `--text-4`
- Trend: 11px/500, `--text-4`. Format: "↑ +4 від минулого" / "↓ -2 від минулого" — arrow direction tells the story. NO colored trend text.

**"Останні доставки" card:**
- Status dot (6px) + order # (JetBrains Mono) + address + chevron
- Sub-row: time · duration · distance — JetBrains Mono, 11px/500, `--text-4`

**"По днях" card:**
- `--text-4` dot + full Ukrainian day name (Понеділок, Вівторок... — NOT abbreviations)
- Sub-row: N доставок · N км (JetBrains Mono, 11px/500, `--text-4`)
- **Today row:** `border-left: 2px solid var(--acm)` + `padding-left: 12px`
- All rows clickable (chevron)

**Day Detail screen:** day name + date, mini summary card, delivery list.

**Delivery Detail screen:**
- Header: "Замовлення #NNNN" (JetBrains Mono, `--text-3`) + date/duration/distance sub-row
- Status indicator: 6px dot + status text (neutral, `--text-3`)
- History map: 180px, neutral dashed polyline (`--acm`)
- Info card detail rows — label (`--text-4`, 11px/500, uppercase, fixed 72px) + value (`--text-2` or JetBrains Mono)

### GPS Consent Screen

Dark background `--bg`. Content centered, icon, title, reasons card.
Primary button: `#f3f2ee` bg (light on dark — monochrome exception for consent screens).
Denied state: `--bad-tint` card with "Відкрити налаштування" button.

---

## Public Tracking Page (/embed/track/[token])

**Exception: light theme.** This public page is embedded in iframe on restaurant websites (mostly light backgrounds). Customers see it, not managers.

- Background: `#faf9f6` (warm white)
- Text: `#1a1918` / `#454340`
- No accent color — same neutral elevation system as dark mode.
- All the same restraint principles apply: minimal color, status dots only, neutral text.

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
          DEFAULT: '#3a3935',
          hover: '#47463f',
          muted: 'rgba(250,249,246,0.05)',
          border: 'rgba(250,249,246,0.16)',
        },
      },
    },
  },
}
```

---

## Do / Don't

### Color — the critical rules

| ✅ Do | ❌ Don't |
|-------|------------|
| Warm parchment `#faf9f6` for primary text | Pure white `#fafafa` or `#ffffff` in dark mode |
| Semi-transparent borders `rgba(250,249,246,0.08)` | Hard hex borders like `#27272a` |
| Status as 6px dot + neutral text | Colored badge pills ("В дорозі" in green) |
| Alert with thin 3px left border | Full-color alert card or banner |
| KPI cards: uniform neutral, no color | Colored top borders on KPI cards |
| Trend text in `--text-4` | Green/red trend arrows or text |
| "Нагадати" as ghost button | Red "Нагадати" button |
| Section headers in `--text-4` uppercase | Sage/green section headers |
| Timer "8хв" as `--text-3` mono text | Amber timer badge |
| Sparklines in `--text-4` | Colored sparklines |
| Neutral elevation (`--surface-3`) for interactive elements | Any hue for interactive elements |
| 3 semantic colors max (green/amber/red) | Info/cyan or any 4th semantic color |

### Typography

| ✅ Do | ❌ Don't |
|-------|------------|
| Max weight 600 for headings | Weight 700 or 800 anywhere |
| Manrope for all UI text | Inter, Roboto, or other body fonts |
| JetBrains Mono for ALL numerical data | Manrope for timestamps, IDs, ETAs |
| Negative letter-spacing on headings | Default tracking on large text |
| UPPERCASE table headers, Micro size | Mixed-case or large `<th>` |

### Layout & Surface

| ✅ Do | ❌ Don't |
|-------|------------|
| `border-radius ≤ 8px` for cards | `rounded-2xl`, `rounded-3xl` |
| Multi-layer shadows, sub-0.4 opacity (dark) | Heavy shadows >0.5 opacity |
| `--shadow-edge` (inset 0.5px) on cards | Thick box-shadow outlines |
| Compact table rows `py-2.5` | Spacious rows `py-4+` |
| Neutral double-ring focus `0 0 0 1px var(--bg), 0 0 0 2px rgba(250,249,246,0.25)` | Single-color outline focus |

### General

| ✅ Do | ❌ Don't |
|-------|------------|
| Remove element if it has no function | Add decoration "for aesthetics" |
| Use dot + text for status | Use colored text for status |
| 90%+ neutral screen at all times | More than 5 colored elements visible |
| Warm tones throughout | Cold/clinical neutral grays |

---

## Comfort Design Principles

These principles guide decisions not covered by specific rules above.

### Eye strain reduction
- Primary text contrast ratio: ~14:1 (warm parchment on warm near-black). High enough for readability, lower than pure white on pure black (~21:1) which causes halation over hours.
- Secondary text at ~8:1. Labels/placeholders at ~4.5:1.
- Never place high-contrast text next to semantic-colored elements — the combination creates visual vibration.

### Weight = volume
- Every font-weight increase is like turning up the volume. Display at 600 speaks confidently. Display at 800 shouts. Over 8 hours, the shouting becomes exhausting.
- If two elements need different prominence, prefer size difference over weight difference.

### The "eye rest zone" principle
- Not every square centimeter needs to carry information. Sidebar margins, padding between sections, card spacing — these are rest zones for the eyes.
- Generous spacing between major sections (32–48px) acts as visual breathing room.

### Semantic color budget
- Before adding a colored element, ask: "Is this one of the 5 most important things on screen right now?"
- If no — make it neutral. The manager's eyes will find it when they scan the data.
- If yes — use the smallest possible colored surface (dot > border > tint > badge > full fill).

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-22 | Sage accent `#6aaa84` as sole interactive color | Calm, distinct from status green, professional. No blue. |
| 2026-04-06 | Removed sage accent — neutral elevation system | Even muted sage competed with `--ok` green over time. Interactive states now use `--surface-3` elevation only. Zero chromatic accent sharpens semantic signal meaning. |
| 2026-03-22 | Semantic-only color rule | Green/amber/red ONLY for courier status + alerts. |
| 2026-03-22 | Dark-first design | Operational command center, evening use. Light mode secondary. |
| 2026-03-22 | Border-radius max 8px for cards | Professional tool, not consumer app. |
| 2026-03-22 | Separate /map page | Info-first dashboard + dedicated map. |
| 2026-03-22 | Leaflet.js + CartoDB Dark Matter | Free, no API key, dark aesthetic. |
| 2026-03-22 | OSRM for real routing + ETA | Real road routes, free. |
| 2026-03-22 | Pulse animation only on danger/background markers | Animation = "look here." Pulsing green is noise. |
| 2026-03-22 | Route-on-select, hidden by default | All routes visible = visual chaos. |
| 2026-03-22 | GPS-first proof, photo optional | Ukrainian hand-to-hand delivery culture. |
| 2026-03-22 | GPS fail never blocks delivery | ZSU GPS spoofing in conflict zones. |
| 2026-04-06 | Warm palette shift (zinc → warm neutrals) | Cold zinc is sterile after 8h. Warm parchment text `#faf9f6` and warmer surfaces reduce eye strain. Inspired by Warp's warm dark approach. |
| 2026-04-06 | Semi-transparent borders | `rgba(250,249,246,0.08)` adapts to surfaces and creates soft containment vs hard hex lines. Inspired by Warp. |
| 2026-04-06 | Weight cap at 600 | 700–800 weights shout. 600 speaks confidently. Size handles hierarchy, not weight. Inspired by Warp (max 500) and ElevenLabs (300 for display). Kept 600 as compromise for operational tool readability. |
| 2026-04-06 | Multi-layer shadow system | Replaced crude 3-tier shadows with layered edge+containment+elevation at low opacity. Surfaces "barely exist" instead of "sticking out." Inspired by ElevenLabs' refined shadow stacking. |
| 2026-04-06 | Quiet Screen Principle — max 5 colored elements | Screenshots revealed 15+ simultaneous colored elements: badges, text, borders, sparklines. Created visual chaos. New rule: 90%+ neutral, color only in dots and thin borders. |
| 2026-04-06 | Removed info/cyan color | 4 semantic colors dilute meaning. Green/amber/red are sufficient. Info states use sage tint or neutral. |
| 2026-04-06 | Status as dot + neutral text, not colored badges | Colored badge pills ("В дорозі" in green, "Не відповідає" in red) were the #1 source of color noise. 6px dot + `--text-3` text conveys the same information with 95% less visual load. |
| 2026-04-06 | KPI cards: uniform neutral | Colored top borders, sparklines, and trend text on KPI cards made the top of the dashboard a color war zone. All KPIs now visually identical — data speaks, chrome doesn't. |
| 2026-04-06 | "Нагадати" as ghost button, not red | A red button next to a red dot next to red text is triple-redundancy. The dot signals danger. The button is just an action. |
| 2026-04-06 | Route color always `--acm` (neutral) | Previously route color matched courier status color, adding another large colored element to the map. Neutral route is consistent and doesn't compete with markers. |
| 2026-04-06 | Negative letter-spacing on body text (-0.006em) | Apple applies negative tracking universally. Subtle tightening at 14px creates a more composed, professional look without affecting readability. |
| 2026-04-06 | Trend text in `--text-4`, no color | Arrow direction (↑/↓) already communicates trend. Coloring trend text green/red adds noise where the data is self-explanatory. |
