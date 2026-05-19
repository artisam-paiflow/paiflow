# BRAND.md — Pink Raft Visual System

> Authoritative style guide for the Pink Raft application. Coding agents must read this in full before building any UI component, theme token, or marketing surface. This document supersedes any earlier draft (the warm/light Daloy/Tukoy direction is **deprecated**).

The aesthetic is **cyber-industrial**: dark, technical, dense, confident. Think Linear meets a Bloomberg terminal meets a Soroban explorer. It signals "industrial-grade automation for decentralized finance," not "friendly fintech for first-timers."

---

## 1. Brand identity

| Field              | Value                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Product name       | **Pink Raft**                                                                                        |
| Tagline            | _Zaps for money · Stellar Soroban_                                                                   |
| Sub-tagline        | _Drag. Drop. Deploy._                                                                                |
| Voice              | Technical, direct, no-fluff. Mid-2020s software product copy — Linear / Vercel / Stripe register.    |
| Mood               | Dark, precise, alive. Subtle motion. Heavy use of monospace.                                         |
| What it is **not** | Warm, cute, cartoonish, mascot-driven, beginner-coded, "Web3 neon explosion," generic crypto purple. |

---

## 2. Color system

All UI must consume colors via the Tailwind tokens below. Do not hardcode hex values in components. The full token map already lives in `tailwind.config` inside each HTML mockup — copy it verbatim into the real Tailwind config.

### Core palette

| Token                       | Hex       | Role                                                             |
| --------------------------- | --------- | ---------------------------------------------------------------- |
| `background` / `surface`    | `#131313` | App background                                                   |
| `surface-container-lowest`  | `#0e0e0e` | Deepest layer (body, behind glass panels)                        |
| `surface-container-low`     | `#1c1b1b` | Side nav, secondary panels                                       |
| `surface-container`         | `#201f1f` | Cards, table headers                                             |
| `surface-container-high`    | `#2a2a2a` | Hover states                                                     |
| `surface-container-highest` | `#353534` | Active row, progress track                                       |
| `primary`                   | `#ffb1c4` | **Pink Raft signature** — primary buttons, accents, active state |
| `primary-container`         | `#ff4a8d` | Hot pink intensifier (badges, callouts)                          |
| `secondary`                 | `#98cbff` | Stellar blue — secondary actions, links, info chips              |
| `secondary-container`       | `#00a2fd` | Saturated blue accent                                            |
| `tertiary`                  | `#ffba20` | Amber — warnings, audit/security highlights                      |
| `on-surface`                | `#e5e2e1` | Body text                                                        |
| `on-surface-variant`        | `#e5bcc5` | Muted body text, labels                                          |
| `outline`                   | `#ac878f` | Visible dividers                                                 |
| `outline-variant`           | `#5c3f46` | Subtle dividers (usually at `/10` to `/30` opacity)              |
| `error`                     | `#ffb4ab` | Error text                                                       |
| `error-container`           | `#93000a` | Error background                                                 |

### Signature accent: `#FF007F`

This electric hot pink shows up in the HTML mockups as inline hex (`text-[#FF007F]`) for the highest-energy text emphasis — live status numbers ("Avg Deploy: 1.2s"), critical amounts, action labels. Use sparingly, always against deep black, never on backgrounds lighter than `surface-container`.

### Semantic usage rules

- **Primary actions** (Deploy, Connect Wallet, New Pipeline): `bg-primary text-on-primary` (`#ffb1c4` on `#65002e`)
- **Secondary actions** (View Audits, Pause Contract): transparent with `border-secondary text-secondary`
- **Triggers** in the visual builder: `secondary` blue (Stellar blue feels right for "incoming/listening")
- **Actions** in the visual builder: `primary` pink (Pink Raft is what _acts_ on the trigger)
- **Logic / conditions**: `tertiary` amber
- **Live / active state**: pulsing `primary` dot with glow
- **Status badges**: solid tinted background at `/10` opacity, border at `/20`, text at full token color

---

## 3. Effects: the visual signatures

These four effects are what make Pink Raft look like Pink Raft. Every screen must use at least one. No screen should use all four simultaneously (visual fatigue).

### 3.1 Grid pattern background

A subtle dot/line grid in Stellar blue at very low opacity sits behind everything. This is non-negotiable — it's the cyber-industrial backbone.

```css
body {
  background-color: #0e0e0e;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(255, 0, 127, 0.03) 0%, transparent 100%),
    linear-gradient(to right, rgba(0, 162, 253, 0.02) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(0, 162, 253, 0.02) 1px, transparent 1px);
  background-size:
    100% 100%,
    32px 32px,
    32px 32px;
}
```

For panel-internal grids (the canvas builder), bump opacity to `0.03` and grid size to `24px`.

### 3.2 Glass panels

The primary surface treatment. Used for cards, side panels, dropdowns, modals.

```css
.glass-panel {
  background: rgba(28, 27, 27, 0.6); /* surface-container-low at 60% */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(92, 63, 70, 0.2); /* outline-variant at 20% */
}
```

Variations:

- **Hero glass** (denser blur): `backdrop-filter: blur(16px)`, background at `rgba(14, 14, 14, 0.8)`
- **Sidebar glass** (heavier): background at `rgba(28, 27, 27, 0.9)`, blur(12px)

### 3.3 Neon glow

Reserved for **selected** elements, **live** statuses, and primary CTAs. Never decorative — always semantic.

```css
.neon-glow {
  border: 1px solid #ffb1c4;
  box-shadow: 0 0 15px rgba(255, 177, 196, 0.3);
}
```

CTA-specific (more intense on hover):

```css
.btn-primary:hover {
  box-shadow: 0 0 20px rgba(255, 177, 196, 0.6);
  transform: translateY(-1px);
}
```

### 3.4 Pulse animation

For "live," "listening," "deploying" status indicators. Always small — never a full-element pulse, just a dot.

```css
@keyframes pulse-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 177, 196, 0.7);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(255, 177, 196, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 177, 196, 0);
  }
}
.status-dot-live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ffb1c4;
  animation: pulse-glow 2s infinite;
}
```

For secondary statuses (deploying, info), swap `primary` → `secondary`. For success, use `tertiary`.

---

## 4. Typography

Three font families, each with a specific job. Load via Google Fonts.

```html
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
  rel="stylesheet"
/>
```

| Family             | Role                    | Where                                                                    |
| ------------------ | ----------------------- | ------------------------------------------------------------------------ |
| **Space Grotesk**  | Headlines, display      | Page titles, section titles, hero copy                                   |
| **Geist**          | Body                    | Paragraphs, descriptions, long-form                                      |
| **JetBrains Mono** | Labels, data, addresses | Stellar addresses, amounts, status chips, timestamps, hashes, table data |

### Type scale (Tailwind tokens)

| Token                | Size | Line height | Letter spacing | Weight | Family         |
| -------------------- | ---- | ----------- | -------------- | ------ | -------------- |
| `headline-lg`        | 48px | 1.1         | -0.02em        | 700    | Space Grotesk  |
| `headline-lg-mobile` | 32px | 1.2         | —              | 700    | Space Grotesk  |
| `headline-md`        | 32px | 1.2         | -0.01em        | 600    | Space Grotesk  |
| `headline-sm`        | 24px | 1.3         | —              | 600    | Space Grotesk  |
| `body-lg`            | 18px | 1.6         | —              | 400    | Geist          |
| `body-md`            | 16px | 1.5         | —              | 400    | Geist          |
| `label-md`           | 14px | 1.4         | 0.05em         | 500    | JetBrains Mono |
| `label-sm`           | 12px | 1.4         | 0.08em         | 500    | JetBrains Mono |

### Typography rules

- Mono is for **data**, not for decoration. Use it on every wallet address (`G...XYZ`), every contract address (`C...XYZ`), every amount, every transaction hash, every timestamp ("2s ago," "12 mins ago"), every status chip.
- Headlines use tight letter-spacing (`-0.01em` to `-0.02em`) for that modern-product feel.
- Labels use wide letter-spacing (`0.05em` to `0.08em`) for that technical-readout feel.
- Never use uppercase for body text. Uppercase is reserved for `label-sm` status badges ("ACTIVE," "DEPLOYING," "TRIGGER," "ACTION") and section eyebrows.
- Wallet/contract addresses are always truncated as `G ABC1...XYZ4` (4 chars at each end, ellipsis middle) and rendered in mono.

---

## 5. Spacing & layout

Tight, deliberate spacing — this is dense software, not a marketing page.

| Token           | Value | Use                                         |
| --------------- | ----- | ------------------------------------------- |
| `xs`            | 4px   | Icon-to-text gaps, badge padding            |
| `sm`            | 12px  | Compact gaps inside cards, button padding-y |
| `base`          | 8px   | Generic unit                                |
| `md` / `gutter` | 24px  | Card padding, gap between cards in a row    |
| `margin`        | 32px  | Page padding-x, section margins             |
| `lg`            | 48px  | Section padding-y                           |
| `xl`            | 80px  | Hero padding-y, major separators            |

### Border radius

| Token     | Value          | Use                                            |
| --------- | -------------- | ---------------------------------------------- |
| `DEFAULT` | 0.125rem (2px) | Inputs, small chips                            |
| `lg`      | 0.25rem (4px)  | Buttons, badges                                |
| `xl`      | 0.5rem (8px)   | Cards, glass panels                            |
| `full`    | 0.75rem (12px) | Hero glass containers (the largest containers) |

Note: this scale is **tighter** than typical shadcn defaults. Sharp corners reinforce the industrial feel. Don't round more than the token system allows.

### Containers

- Max width: `container mx-auto` (Tailwind's default ~1280px) for marketing pages
- App pages: full-width with `md:ml-64` for sidebar offset
- Top nav fixed at `h-16` (64px)
- Side nav fixed at `w-64` (256px) on desktop, hidden on mobile (use floating action button instead)
- Page content padding-top: `pt-20` (80px) or `pt-24` (96px) to clear fixed nav

---

## 6. Component patterns

### Buttons

Three variants only. Don't invent more.

**Primary**

```html
<button
  class="bg-primary text-on-primary font-label-md text-label-md px-lg py-sm rounded-lg font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.6)] active:scale-95"
>
  Start Building
</button>
```

**Secondary** (outlined)

```html
<button
  class="border-secondary text-secondary font-label-md text-label-md px-lg py-sm hover:bg-secondary/10 rounded-lg border bg-transparent transition-all duration-200 hover:shadow-[0_0_12px_rgba(152,203,255,0.4)]"
>
  View Audits
</button>
```

**Icon button**

```html
<button class="text-on-surface-variant hover:text-primary p-xs transition-colors duration-200">
  <span class="material-symbols-outlined">settings</span>
</button>
```

### Status chips

Pattern: `bg-{color}/10 border border-{color}/20 text-{color}` + inline pulsing dot when live.

```html
<!-- Active (primary pink) -->
<div
  class="bg-primary/10 border-primary/20 text-primary font-label-sm inline-flex items-center gap-2 rounded border px-2 py-1"
>
  <span
    class="bg-primary shadow-[0_0_6px_theme(colors.primary)] h-1.5 w-1.5 animate-pulse rounded-full"
  ></span>
  Active
</div>

<!-- Deploying (secondary blue) -->
<!-- Paused (outline-variant, no animation) -->
<!-- Failed (error red) -->
```

### Cards / glass panels

```html
<div
  class="glass-panel p-md gap-sm hover:border-primary/50 flex flex-col rounded-xl transition-colors"
>
  <!-- icon + headline + body + meta row -->
</div>
```

Hero cards (denser content): use `rounded-full` (12px) and `p-md` to `p-lg`.

### Form inputs

```html
<input
  class="bg-surface-container-lowest border-outline-variant/50 text-on-surface p-xs pl-sm focus:border-primary focus:ring-primary w-full rounded border font-mono text-sm transition-all focus:ring-1 focus:outline-none"
/>
```

Labels above inputs, in `label-sm` mono, `text-on-surface-variant`. On focus, label color shifts to `primary` (use `group-focus-within:text-primary`).

### Data tables

Use CSS Grid, not `<table>`, for the high-density tables on Dashboard/Vault pages. Header row in `surface-container/80`, body rows with `border-b border-outline-variant/10`, hover at `surface-container-high/40`.

```html
<div class="data-row px-md py-sm hover:bg-surface-container-high/40 group transition-colors">
  <!-- columns -->
  <div class="opacity-0 transition-opacity group-hover:opacity-100">
    <!-- row actions appear on hover -->
  </div>
</div>
```

Where:

```css
.data-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.5fr 1fr auto;
  align-items: center;
}
```

### Visual builder nodes (canvas)

Each node is a glass panel with:

- Header: icon + uppercase `label-sm` category label ("TRIGGER" / "ACTION" / "LOGIC")
- Body: bold `headline-sm` title, mono address/details, mono parameter row
- Connector port: 24px circle, absolutely positioned at edge, `bg-surface-container border border-{semantic}`
- Selected state: full `neon-glow`
- Live state: pulsing dot in header

Edges between nodes are dashed `stroke-primary` SVG paths with animated `stroke-dashoffset` for the "flowing" feel.

---

## 7. Iconography

**Use Material Symbols Outlined.** Loaded from Google Fonts via the variable axis link in the mockups.

```html
<link
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
  rel="stylesheet"
/>
```

Render with `<span class="material-symbols-outlined">{icon_name}</span>`. Set fill via inline style or class:

```html
<!-- Unfilled (default, for inactive/secondary) -->
<span class="material-symbols-outlined">dashboard</span>

<!-- Filled (for active nav items, status icons) -->
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">dashboard</span>
```

### Block-to-icon mapping (visual builder)

| Block       | Icon                     |
| ----------- | ------------------------ |
| On Receive  | `toll` or `download`     |
| On Schedule | `schedule`               |
| Pay         | `payments`               |
| Split       | `call_split`             |
| Condition   | `account_tree` or `rule` |

### Common UI icons

`dashboard`, `account_tree`, `rocket_launch`, `account_balance_wallet`, `receipt_long`, `settings`, `notifications`, `add`, `arrow_forward`, `bolt`, `hub`, `verified`, `verified_user`, `security`, `history`, `tag`, `schedule`, `check_circle`, `more_vert`, `search`, `filter_list`, `zoom_in`, `zoom_out`, `fit_screen`, `key`, `help`.

Default size 24px (Material default). Use `text-[18px]`, `text-[16px]`, `text-[14px]` for inline icons next to text.

**Do not use:** Lucide, Heroicons, Feather, or emoji. The visual system is committed to Material Symbols.

---

## 8. Motion

Subtle, fast, purposeful. Never decorative. The aesthetic is precision-tool, not playful.

| Element                                          | Behavior                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| Hover state                                      | `transition-colors duration-200`                  |
| Active state (button press)                      | `active:scale-95 transition-transform`            |
| CTA hover                                        | `hover:-translate-y-px` + glow shadow             |
| Live status dots                                 | 2s pulse, infinite                                |
| Canvas edge                                      | 20s linear infinite `stroke-dashoffset` animation |
| Data appearing (rows, toasts)                    | `slide-in-from-top` 200ms ease-out                |
| Mascot, confetti, bouncing icons, springy easing | **Do not use.**                                   |

Respect `prefers-reduced-motion`: kill the dashed-line animation and pulse, keep color transitions only.

---

## 9. Page-level patterns

The HTML mockups define four canonical surfaces. Match these when implementing new pages.

### Landing page (`/`)

- Fixed translucent top nav (`h-16`, `bg-surface/80 backdrop-blur-xl`)
- Hero section: split layout, headline left, animated canvas preview right
- Status line under hero copy: pulsing dot + "System Status: Stellar Testnet Online | Avg Deploy: 1.2s"
- Bento grid features section: 3 columns on desktop, glass panels, hover border color shifts to the block category color
- No footer needed for v1

### Dashboard (`/`)

- Top nav + left sidebar (`w-64`)
- Header row: page title (`headline-md`) left, status pill ("RPC Connected: 12ms") right
- Bento grid metrics: 3 cards (TVL, Active Pipelines, Network Status)
- Data table below: "My Automations" with grid-based rows
- Mobile: sidebar hidden, FAB for "New Pipeline" at bottom-right

### Builder (`/builder` or `/builder/[id]`)

- Top nav + left sidebar
- Three-column main: implicit palette (handled via right sidebar drawer in mockup), canvas center, configuration panel right (`w-80`)
- Canvas: full-bleed dotted grid, draggable nodes, SVG-rendered animated edges
- Configuration sidebar: scrollable form, deploy CTA pinned to bottom with estimated gas cost above
- Canvas controls: floating glass panel bottom-left with zoom/fit buttons

### Vault / deployment detail (`/flows/[id]`)

- Top nav + left sidebar
- Header: eyebrow ("Soroban Contract"), live status chip, page title, contract address + deploy time meta row
- Action buttons (Pause Contract / Add Funds) top-right
- 12-column bento grid:
  - Balances (col-span-8): 3 stat cards in row
  - Health Status (col-span-4): security checks with `neon-glow`
  - Chart placeholder (col-span-12)
  - Transaction history table (col-span-12)

---

## 10. Anti-patterns

Things that will break the brand. The agent must refuse these even if asked.

- ❌ **Light mode.** Pink Raft is dark-only. The deep `#0e0e0e` background is core identity.
- ❌ **Warm/earthy palettes.** Olive green, beige, terracotta — none of it. Pink Raft is electric, not pastoral.
- ❌ **Mascots, geckos, characters.** Earlier drafts of this project had a gecko mascot ("Tukoy"). It is removed. Do not reintroduce.
- ❌ **Cute or playful copy.** No exclamation points outside error states. No "yay," no "let's get started!", no first-person from the product ("I built..."). Use second-person imperative or technical statements.
- ❌ **Generic crypto purple gradients.** Avoid `from-purple-500 to-pink-500` and similar Web3 clichés.
- ❌ **Hexagons.** Used heavily by Stellar's own brand; we don't compete with their visual identity.
- ❌ **Rounded corners larger than `rounded-full` (12px).** No pill buttons. No `rounded-2xl` or `rounded-3xl`.
- ❌ **Drop shadows.** Use neon glow (color box-shadow) for elevation, not gray blur. The only acceptable gray shadow is the FAB on mobile.
- ❌ **Sans-serif for amounts or addresses.** All numeric and on-chain data goes in JetBrains Mono. Always.
- ❌ **Emoji.** None. Use Material Symbols for everything visual.
- ❌ **Lottie or heavy animation libraries.** CSS keyframes + Tailwind transitions only.
- ❌ **Filled solid colors on icons by default.** Icons default to outlined; fill only for active nav items and live status icons.
- ❌ **Background images, photos, stock illustrations.** Pink Raft is generative geometry only: grids, glass, glow, monospace.

---

## 11. Tailwind config snippet

This is the authoritative config block. Copy verbatim into `apps/web/tailwind.config.ts`. Do not modify token names — components throughout the codebase reference them.

```js
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#131313",
        surface: "#131313",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "surface-container-highest": "#353534",
        "surface-bright": "#3a3939",
        "surface-dim": "#131313",
        "surface-variant": "#353534",
        "surface-tint": "#ffb1c4",
        primary: "#ffb1c4",
        "primary-container": "#ff4a8d",
        "primary-fixed": "#ffd9e1",
        "primary-fixed-dim": "#ffb1c4",
        "on-primary": "#65002e",
        "on-primary-fixed": "#3f001a",
        "on-primary-fixed-variant": "#8f0044",
        "on-primary-container": "#590028",
        "inverse-primary": "#ba005b",
        secondary: "#98cbff",
        "secondary-container": "#00a2fd",
        "secondary-fixed": "#cfe5ff",
        "secondary-fixed-dim": "#98cbff",
        "on-secondary": "#003354",
        "on-secondary-fixed": "#001d33",
        "on-secondary-fixed-variant": "#004a77",
        "on-secondary-container": "#003558",
        tertiary: "#ffba20",
        "tertiary-container": "#bc8700",
        "tertiary-fixed": "#ffdea8",
        "tertiary-fixed-dim": "#ffba20",
        "on-tertiary": "#412d00",
        "on-tertiary-fixed": "#271900",
        "on-tertiary-fixed-variant": "#5e4200",
        "on-tertiary-container": "#392600",
        error: "#ffb4ab",
        "error-container": "#93000a",
        "on-error": "#690005",
        "on-error-container": "#ffdad6",
        outline: "#ac878f",
        "outline-variant": "#5c3f46",
        "on-surface": "#e5e2e1",
        "on-surface-variant": "#e5bcc5",
        "on-background": "#e5e2e1",
        "inverse-surface": "#e5e2e1",
        "inverse-on-surface": "#313030",
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem",
      },
      spacing: {
        xs: "4px",
        sm: "12px",
        base: "8px",
        md: "24px",
        gutter: "24px",
        margin: "32px",
        lg: "48px",
        xl: "80px",
      },
      fontFamily: {
        "headline-lg": ["Space Grotesk", "sans-serif"],
        "headline-lg-mobile": ["Space Grotesk", "sans-serif"],
        "headline-md": ["Space Grotesk", "sans-serif"],
        "headline-sm": ["Space Grotesk", "sans-serif"],
        "body-lg": ["Geist", "sans-serif"],
        "body-md": ["Geist", "sans-serif"],
        "label-md": ["JetBrains Mono", "monospace"],
        "label-sm": ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "headline-lg": ["48px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg-mobile": ["32px", { lineHeight: "1.2", fontWeight: "700" }],
        "headline-md": ["32px", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-sm": ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
        "label-md": ["14px", { lineHeight: "1.4", letterSpacing: "0.05em", fontWeight: "500" }],
        "label-sm": ["12px", { lineHeight: "1.4", letterSpacing: "0.08em", fontWeight: "500" }],
      },
    },
  },
};
```

---

## 12. Global CSS to ship

Put this in `apps/web/src/app/globals.css` after Tailwind's base layer.

```css
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap");
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap");

body {
  background-color: #0e0e0e;
  color: #e5e2e1;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(255, 0, 127, 0.03) 0%, transparent 100%),
    linear-gradient(to right, rgba(0, 162, 253, 0.02) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(0, 162, 253, 0.02) 1px, transparent 1px);
  background-size:
    100% 100%,
    32px 32px,
    32px 32px;
}

.glass-panel {
  background: rgba(28, 27, 27, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(92, 63, 70, 0.2);
}

.neon-glow {
  border: 1px solid #ffb1c4;
  box-shadow: 0 0 15px rgba(255, 177, 196, 0.3);
}

.neon-border-primary {
  border: 1px solid #ffb1c4;
  box-shadow: 0 0 8px #ffb1c4;
}

@keyframes pulse-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 177, 196, 0.7);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(255, 177, 196, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 177, 196, 0);
  }
}

.status-dot-live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ffb1c4;
  animation: pulse-glow 2s infinite;
}

@keyframes flow-dash {
  to {
    stroke-dashoffset: -1000;
  }
}

path.connection-line {
  stroke: #ffb1c4;
  stroke-width: 2;
  fill: none;
  stroke-dasharray: 6;
  animation: flow-dash 20s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .status-dot-live,
  path.connection-line {
    animation: none;
  }
}
```

---

## 13. Quick reference for the agent

When building any new UI:

1. Start with `glass-panel` for containers, `surface-container-lowest` for the page.
2. Pick **one** signature effect to lead the screen — never stack glow + intense pulse + animated edges + heavy glass all on the same component.
3. Body text in Geist, data in JetBrains Mono, headlines in Space Grotesk. No exceptions.
4. Primary CTA is pink (`primary`), secondary is blue outline (`secondary`). One primary per screen.
5. Live indicators always include a pulsing dot. Address strings always truncate `G ABC1...XYZ4`. Amounts always mono.
6. Hover states use color transitions, not motion. Buttons can lift 1px on hover; nothing else moves.
7. When in doubt, look at the four HTML mockups in the repo (`/mockups/landing.html`, `dashboard.html`, `builder.html`, `vault.html`) — they are the visual truth.

---

## 14. Updating this document

If you (the agent) need to deviate from this guide:

1. Write an ADR in `docs/adr/` proposing the change with rationale
2. Reference the affected sections of this file
3. Wait for human approval
4. Update both this `BRAND.md` and the relevant Tailwind config / global CSS

Do not silently introduce new colors, new fonts, new effects, or new component patterns.
