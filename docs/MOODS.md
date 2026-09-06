# Moods

A mood is a coordinated delta across multiple tokens. One command shifts the whole feel.

## Built-in moods

- **default** — baseline (the seed palette)
- **clinical** — cool blue + tighter spacing + sharper radius
- **editorial-warm** — terracotta + parchment + softer
- **aggressive-bold** — pure black/white + neon red + tight
- **minimalist-quiet** — whisper-soft, low-contrast, generous space
- **luxurious-refined** — champagne on slate, italic serif headlines

## Apply

```bash
npx tincture mood apply clinical
```

Writes deltas to `registry.json` and regenerates `_generated/`.

## Author your own

Drop a JSON file in `tincture/moods/<name>.json`:

```json
{
  "id": "my-mood",
  "name": "My Mood",
  "doc": "What this mood feels like, what it's for.",
  "base": "default",
  "tokens": {
    "accent": { "lightValue": "#1F75FE", "darkValue": "#5BA8FF" },
    "ink":    { "lightValue": "#0A0A0A", "darkValue": "#FAFAFA" }
  },
  "axis-defaults": { "surface": "light", "flavor": "cool" }
}
```

Then `npx tincture mood apply my-mood`.

## Diff between moods

```bash
npx tincture mood diff clinical editorial-warm
```

## Runtime moods (no CLI, no build) — 0.3.0

Turn the indirection on in the registry and the generated foundation resolves every unlocked
token through `var(--mood-<id>, <value>)`, in every axis cell:

```jsonc
// tincture/registry.json
{ "version": "0.3.0", "runtime-moods": true, "tokens": { … } }
```

```css
/* _generated/foundation.css — emitted */
:root                 { --accent: var(--mood-accent, #C41E3A); }
[data-surface="dark"] { --accent: var(--mood-accent, #FA4020); }
```

Now a mood is just `--mood-*` custom properties on an ancestor. Nested `[data-surface]`
blocks keep resolving underneath it instead of stomping it. Locked (`brand-lock`) tokens are
emitted raw — moods cannot override them, so there is nothing to indirect. Off by default;
`--runtime-moods` / `--no-runtime-moods` on `tincture codegen` override the registry field.

`@tincture/core/runtime` turns a mood JSON into those properties three ways:

```js
import { moodVars, moodCss, applyMood, clearMood } from '@tincture/core/runtime';

// SSR / React: the layout already knows the surface → one cell, as a style object
<html data-surface={mode} style={moodVars(warm, { surface: mode })}>

// Every cell at once, as CSS under [data-mood="warm"] (wrapper AND descendant forms)
<style>{moodCss(warm)}</style>   …   <main data-mood="warm">

// DOM: set / unset on an element
applyMood(document.documentElement, warm, { surface: 'dark' });
clearMood(document.documentElement, warm);
```

**Already switching on another attribute?** `"axis-attributes": { "surface": "data-theme" }` in the
registry keys that axis's cells on `[data-theme=…]` instead of `[data-surface=…]` — codegen,
manifest selectors and `moodCss(mood, { attributes })` all follow it. An app keeps its existing
switch; nothing else changes.

Accepts both mood shapes (`values` cells, or `lightValue`/`darkValue`). **A mood with no
tokens is a visual no-op** — every `var()` takes its fallback, byte-for-byte the un-mooded
foundation. Validate moods against the registry at build time (`schema.validateMood`); the
runtime does not re-check locks.

## Per-page activation (no CLI, runtime)

The CLI applies a mood site-wide by mutating the registry. There's a second
mode: activate a mood on **any wrapper element** at runtime via a
`data-mood` attribute. This is how you give one route, one persona, or one
feature card its own character without touching the rest of the site.

```html
<main data-mood="jennifer-editorial">
  <!-- This subtree resolves --accent, --font-display, etc. from
       jennifer-editorial. Everything outside stays default. -->
</main>
```

A per-page mood is the same JSON shape, but with two important differences
from a site-wide mood:

1. **Sparse tokens.** Override only what you actually want different from
   the surrounding default. A 12-token mood on a single route reads as
   *"why is this page on a different website?"* A 3- or 4-token mood reads
   as *a deliberate signal layer.*

2. **No CLI invocation.** The mood file ships in your bundle, the
   `[data-mood="X"]` block ships in `surface-extensions.css`, the attribute
   gets set by your framework when the route matches.

Full pattern (Next.js layout, partial-token discipline, activation
strategies, common pitfalls): [`docs/architecture/per-page-moods.md`](./architecture/per-page-moods.md).

Template: [`src/moods/per-page-example.json`](../src/moods/per-page-example.json).

Example: a fitness-studio consumer ships a `jennifer-editorial` mood on
`/about/<co-founder>` — swaps brand red for champagne gold and the
display typeface for an editorial serif, cascading through navbar, page,
and footer simultaneously.
