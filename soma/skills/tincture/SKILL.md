---
name: tincture-css
description: >
  Implement Tincture CSS — a surface-aware, multi-axis design substrate — in
  any web project. Use when someone wants to add Tincture to a project, create
  or edit tokens, apply a mood, scan for missing surface annotations, debug
  theme behaviour, or understand how the axis/surface/mood model works. Also
  use when asked about design tokens, theming systems, dark mode architecture,
  or AI-mediated palette swaps.
license: MIT
metadata:
  author: curtismercier
  version: "0.2.2"
  source-style: authored
  home-repo: curtismercier/tincture-css
  created: 2026-04-30
  last_reviewed: 2026-05-01
  review_interval_days: 90
  tier: 2
---

# tincture-css skill

Tincture is a surface-aware, multi-axis design substrate. This skill covers
installing it, configuring it, adding tokens, applying moods, and debugging.

## The mental model (read this first)

Tincture has three concepts. Understand them before touching any files.

**1. Tokens are value matrices, not pairs.**
A token's value depends on which *axes* are active — `surface` (dark/light/steel/slate),
`flavor` (warm/cool), `elevation`, `tone`. Codegen emits one CSS rule per axis-cell.

```json
{
  "ink": {
    "kind": "color",
    "axes": ["surface"],
    "values": {
      "default":          "#1A1612",
      "surface=dark":     "#FFFFFF",
      "surface=steel":    "#F0EDE8"
    }
  }
}
```

Emits:
```css
:root                  { --ink: #1A1612; }
[data-surface="dark"]  { --ink: #FFFFFF; }
[data-surface="steel"] { --ink: #F0EDE8; }
```

**2. A mood is a coordinated delta.**
It patches multiple tokens at once. Apply a mood → every consumer token that
the mood touches shifts together. One command, no component edits.

Moods activate in two distinct modes:
- **Site-wide** (registry / CLI) — `tincture mood apply X` writes the delta to
  `registry.json` and re-runs codegen. Whole-site rebrand.
- **Per-page** (runtime / DOM attribute) — `[data-mood="X"]` on any wrapper
  element activates the mood for that subtree only. Cascades through nested
  data-surface blocks (incl. navbar + footer if they're under the wrapper).
  No registry mutation, no rebuild. The mood JSON ships in the bundle and
  the framework sets the attribute when the route matches.

Use site-wide for whole-site identity flips and A/B tests; use per-page for
signature pages, single-persona flavours, and feature-card demonstrations.

**3. `data-surface` is the annotation.**
Every section/wrapper with a dark background needs `data-surface="dark"`.
Tincture's scanner flags missing annotations before deploy. Without the
annotation, `var(--ink)` resolves to the wrong value.

---

## Installing Tincture in a new project

### Step 1: config

Create `tincture.config.json` at the project root (copy from
`tincture.config.example.json`):

```json
{
  "registryPath": "src/tokens/registry.json",
  "outDir":       "src/tokens/_generated",
  "moodsDir":     "src/tokens/moods"
}
```

### Step 2: scaffold a registry

```bash
tincture create my-brand
# → creates registryPath with 7 starter tokens (ink, bg, accent, border, radius-md, shadow-lifted, type-display-1)
```

Or copy `src/registry.v02-example.json` and adapt it.

### Step 3: codegen

```bash
tincture codegen
# → emits _generated/foundation.css, manifest.json, tokens.d.ts
```

### Step 4: import

**Tailwind v4:**
```css
/* globals.css */
@import "tailwindcss";
@import "./tokens/_generated/foundation.css";
```

**Plain CSS:**
```html
<link rel="stylesheet" href="/tokens/_generated/foundation.css">
```

### Step 5: Next.js font bridge

Next/font CSS vars are scoped to the element with the font className, not
`:root`. Bridge them at the layout root wrapper:

```tsx
<div className="[--font-display:var(--font-display-stack)] [--font-body:var(--font-sans)]">
  {children}
</div>
```

### Step 6: add `pnpm` scripts (optional)

```json
{
  "scripts": {
    "tincture:codegen": "tincture codegen",
    "tincture:scan":    "tincture scan",
    "tincture:mood":    "tincture mood apply"
  }
}
```

---

## Adding a token

Edit `registry.json`. Each token needs:

| Field | Required | What it is |
|---|---|---|
| `kind` | ✓ | `color` / `typography` / `shadow` / `radius` / `brand-lock` |
| `axes` | ✓ | Array of axis names this token varies on, e.g. `["surface"]` |
| `values` | ✓ | Object mapping axis-cell keys to values |
| `doc` | — | Human description |
| `locked` | — | `true` to prevent mood overrides |
| `consumers` | — | Array of `{ file, element, property }` for `tokens impact` |

After editing: `tincture codegen` to re-emit CSS.

### Token value key syntax

| Key | When emitted |
|---|---|
| `"default"` | `:root {}` |
| `"surface=dark"` | `[data-surface="dark"] {}` |
| `"surface=dark,flavor=warm"` | `[data-surface="dark"][data-flavor="warm"] {}` |
| `"flavor=cool"` | `[data-flavor="cool"] {}` |

---

## Applying a mood

```bash
tincture mood apply performance
```

This patches `registry.json` with the mood's delta values, then re-runs
codegen. The mood JSON lives in `moodsDir/performance.json`.

**Preview without committing:**
```bash
tincture mood preview luxurious-refined
```

**Roll back:**
```bash
# mood-v2.mjs saves registry.baseline.json before patching
tincture mood apply default
```

---

## Creating a mood

Create `moodsDir/my-mood.json`:

```json
{
  "id": "my-mood",
  "name": "My Mood",
  "doc": "One sentence describing the character.",
  "base": "default",
  "tokens": {
    "accent": {
      "values": {
        "default":      "#0070F3",
        "surface=dark": "#3B9EFF"
      }
    },
    "weight-display": {
      "values": { "default": "800" }
    }
  }
}
```

Only declare tokens you want to shift. Everything else inherits from `base`.

---

## Per-page moods (runtime, no CLI)

The same `--mood-*` indirection that powers a site-wide mood swap also
activates a mood on any DOM wrapper via `data-mood="X"`. Use it when one
person, one product, or one route deserves its own character without
forking the page.

```tsx
// Next.js layout pattern — reaches navbar + page + footer
export default async function TenantLayout({ children }) {
  const pathname = await getCurrentPathname();
  const mood = pathname === '/about/<co-founder>'
    ? 'jennifer-editorial'
    : undefined;

  return (
    <div data-mood={mood}>
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
```

The mood JSON shape is identical to a site-wide mood but with a critical
authoring discipline: **partial-token override**. Only override tokens you
actually want different from the surrounding default. A 12-token per-page
mood reads as *"why is this page on a different website?"* A 3- or 4-token
mood reads as *a deliberate signal layer*.

The smallest interesting per-page mood is usually accent + font:

```json
{
  "id": "jennifer-editorial",
  "name": "Jennifer Editorial",
  "base": "luxurious-refined",
  "tokens": {
    "accent":      { "lightValue": "#B8860B", "darkValue": "#E8C566" },
    "accent-warm": { "lightValue": "#B8860B", "darkValue": "#E8C566" },
    "accent-fg":   { "lightValue": "#1A1612", "darkValue": "#1A1612" },
    "font-display":{ "lightValue": "var(--font-dm-serif)", "darkValue": "var(--font-dm-serif)" }
  },
  "active-tokens":  ["accent", "accent-warm", "accent-fg", "font-display"],
  "shelved-tokens": ["ink", "bg", "bg-card", "bg-elev", "border"]
}
```

Along with the JSON, add the corresponding `[data-mood="X"]` block to
`surface-extensions.css`. The mood is now activatable from any wrapper.

**Activation strategies** (full doc:
[`docs/architecture/per-page-moods.md`](./docs/architecture/per-page-moods.md)):
- **Route layout** — reaches navbar + page + footer (most common)
- **Page component** — page-only, chrome stays branded
- **Per-section** — single feature card demonstrates a mood; rest of page stays default

**Brand-locked tokens still cannot be overridden** in per-page mode. Per-page
logo variants ship as **asset swaps** (different SVG when the path matches),
not as token overrides.

Template: [`src/moods/per-page-example.json`](./src/moods/per-page-example.json).

---

## Annotating surfaces

Every element with a dark background (or any non-default surface) needs an
annotation:

```tsx
<section data-surface="dark">
  {/* var(--ink) → white, var(--accent) → dark-surface value */}
</section>

<section data-surface="slate">
  {/* intermediate dark surface */}
</section>

<section data-surface="steel">
  {/* data-heavy dark surface */}
</section>
```

**Scan before deploy:**
```bash
tincture scan
# reports any dark-bg class without matching data-surface
```

---

## Debugging token resolution

**Check what a token emits:**
```bash
tincture tokens get ink
# prints: default: #1A1612, surface=dark: #FFFFFF, ...
```

**Check what components use a token:**
```bash
tincture tokens impact accent
# lists all files in registry.json consumers[] for this token
```

**Contrast audit:**
```bash
tincture contrast
# WCAG AA/AAA audit across all surface × token pairs
```

---

## Common errors

**Token resolves to wrong value:**
- Missing `data-surface` annotation. Add it to the section wrapper.
- The annotation is on a child, not the section root. Move it up.

**`var(--ink)` shows as empty in DevTools:**
- `tincture codegen` hasn't been run since registry edit.
- The CSS import is missing from globals.css.

**Mood delta rejected:**
- Token has `"locked": true`. Locked tokens cannot be mood-overridden by design.

**Per-page mood applied but page looks like a different website:**
- The mood is overriding too many tokens. Check `--bg`, `--ink`, `--bg-card`
  — those are the foundation of the page's visual identity. Per-page moods
  should usually leave them alone and only shift accent + font + maybe
  border. See partial-token discipline in the per-page moods doc.

**Per-page mood activates but footer doesn't pick it up:**
- The footer is being rendered OUTSIDE the wrapper that has `data-mood="X"`.
  Move the attribute up to a wrapper that includes both the page and the
  footer (typically the layout root).

**Next.js: `--font-display` not applying:**
- Missing font bridge. See Step 5 above — Next/font vars don't reach `:root`.

**Dark demo pages look light in light-mode:**
- `var(--bg)` follows the theme. For always-dark pages (admin dashboards,
  internal tools), pin the background directly: `bg-[#12151C]` and set all
  descendant vars explicitly, or use a wrapper with all vars inlined.

---

## Files produced by codegen

| File | What it is |
|---|---|
| `_generated/foundation.css` | The CSS the app actually imports |
| `_generated/manifest.json` | Machine-readable token map (used by CLI tools) |
| `_generated/tokens.d.ts` | TypeScript types for token IDs |

Never edit these directly — they are overwritten by `tincture codegen`.

---

## Seams

- **Repo:** `curtismercier/tincture-css`
- **README:** full comparison vs Style Dictionary, Radix Colors, Panda CSS, shadcn/ui, Tailwind v4
- **Proving ground:** a fitness-studio consumer (Next.js 15 + Tailwind v4)
- **Config discovery:** `_resolve-config.mjs` reads `tincture.config.json` walking up from CWD
- **Schema:** `src/schema.mjs` — plain JS, no runtime dependencies
