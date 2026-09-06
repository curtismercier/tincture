# surface-extensions.css — the mood bridge pattern

> **Since 0.3.0 the codegen emits this bridge itself.** Set `"runtime-moods": true` in the
> registry (or pass `--runtime-moods`) and every unlocked token in every cell is emitted as
> `--id: var(--mood-id, <value>)`. The hand-maintained block below is then only needed for
> **surfaces the registry does not declare** (§ Adding surfaces). Apply moods with
> `@tincture/core/runtime` (`moodVars` / `moodCss` / `applyMood`) — see `docs/MOODS.md` § Runtime.
> Consumers that keep a hand-written bridge get identical behaviour; nothing breaks.

## The problem

The tincture codegen outputs `_generated/foundation.css` from a token registry.
That file defines surface blocks with hardcoded values:

```css
[data-surface="dark"] {
  --accent: #E00;
  --ink: #FFF;
}
```

If you apply a mood override on a wrapper div (`style="--accent: orange"`),
the child section's `[data-surface="dark"]` re-declares `--accent` — stomping
the inherited mood value. Moods appear to do nothing on surfaced sections.

## The solution — var() indirection layer

Create a `tincture/surface-extensions.css` imported **after** the generated
file. It re-declares the same tokens as `var(--mood-TOKEN, hardcoded-fallback)`:

```css
[data-surface="dark"] {
  --accent: var(--mood-accent, #E00);  /* mood wins if set; falls back to surface default */
  --ink:    var(--mood-ink,    #FFF);
}
```

Import order in your main CSS file:

```css
@import "./tincture/_generated/foundation.css";  /* codegen — do not edit */
@import "./tincture/_generated/flavors.css";
@import "./tincture/surface-extensions.css";     /* mood bridge — hand-maintained */
```

## How it works

CSS custom properties inherit parent → child. When `showroomStyle` sets
`--mood-accent: orange` on a wrapper:

1. `--mood-accent` inherits into all descendant elements
2. `[data-surface="dark"]` evaluates `var(--mood-accent, #E00)` — finds the
   inherited `orange` — uses it for `--accent` in that section
3. When no mood is active, `--mood-accent` is unset → fallback `#E00` applies

The fallback values should match your surface defaults exactly.

## Tokens to passthrough

Not all tokens need mood indirection. Only those that moods actually vary:

```
--accent, --accent-warm, --accent-fg  → colour palette shifts
--ink, --ink-soft, --ink-muted        → tone/warmth shifts
--bg, --bg-card, --bg-elev            → background tinting
--border, --border-soft               → border tone shifts
```

Typography tokens (`--weight-display`, `--leading-tight`, `--track-display`)
don't need indirection — surfaces don't redefine them, so they cascade freely.

## Adding surfaces not in the codegen

`surface-extensions.css` is also where you add surfaces the registry doesn't
know about yet (e.g. `slate`, `steel`):

```css
[data-surface="slate"] {
  color-scheme: dark;
  --bg:    var(--mood-bg,   #242A36);
  --ink:   var(--mood-ink,  #E8EAF0);
  --accent:var(--mood-accent,#E82E11);
  /* ... */
}
```

This keeps the codegen output clean and gives you a stable place to iterate
new surfaces before formalising them in the registry.

## Updating mood generators

When a mood JSON sets `--accent`, the generator should instead emit
`--mood-accent` so it flows through the indirection:

```js
const MOOD_PASSTHROUGH = new Set([
  'accent', 'accent-warm', 'accent-fg',
  'ink', 'ink-soft', 'ink-muted',
  'bg', 'bg-card', 'bg-elev',
  'border', 'border-soft',
]);

const cssVar = MOOD_PASSTHROUGH.has(tokenId)
  ? `--mood-${tokenId}`   // cascades through surfaces
  : `--${tokenId}`;       // typography — surfaces don't touch these
```

## File responsibilities

| File | Owned by | Purpose |
|------|----------|---------|
| `_generated/foundation.css` | Codegen | Base `:root` tokens — and the mood bridge when `runtime-moods` is on |
| `_generated/flavors.css` | Codegen | Flavor overrides |
| `surface-extensions.css` | Hand-maintained | New surfaces (+ the mood bridge only for pre-0.3 registries) |
| `globals.css` | Hand-maintained | Import order + project tokens |

## See also

The `--mood-*` indirection layer documented here is what powers
**per-page moods** — moods activated via a `data-mood="X"` attribute on
any DOM wrapper rather than via a site-wide CLI swap. The same fallback
pattern (`var(--mood-X, default)`) lets any descendant subtree pick up a
different mood without touching the registry.

→ [`per-page-moods.md`](./per-page-moods.md) for the activation pattern,
authoring discipline, and live production example (Arzadon Fitness's
`jennifer-editorial`).
