---
type: content
name: tincture
status: active
description: >
  Tincture CSS — surface-aware, multi-axis design substrate. The doorway:
  what it is, the four commands, when to reach for it, and the one hard rule.
updated: 2026-08-01
---

# Tincture

**Tincture is a design-token substrate where a token's value depends on which
axes are active** — `surface` (dark/light/steel/slate), `flavor` (warm/cool),
`elevation`, `tone`. Tokens are value *matrices*, not light/dark pairs. Codegen
emits one CSS rule per axis-cell; consumers use plain CSS variables and never
branch on theme in component code.

Package: `@tincture/core` (unpublished — runs from this repo).
Engine + CLI live in `core/`; entry is `core/src/cli/tincture.mjs`.
Deeper playbook: `soma/skills/tincture/SKILL.md`.

## The four commands

| Command | What it does |
|---|---|
| `tincture codegen` | Re-emit `_generated/` (CSS variables, manifest, types) from the registry |
| `tincture scan` | Find hardcoded colors in CSS / Tailwind / inline styles — the drift detector |
| `tincture contrast` | WCAG 2.1 + APCA contrast matrix, computed **per surface** |
| `tincture mood list` / `mood apply <name>` | Coordinated palette deltas — retheme without touching tokens |

Run via `./node_modules/.bin/tincture` in a consumer, or
`node core/src/cli/tincture.mjs` from this repo. Bare `tincture` prints the
command list and **exits 2 by convention — that is not a failure.**

## When to reach for it

- A project needs theming beyond a light/dark boolean (surfaces, flavors, moods).
- You're about to hardcode a hex in component code → `tincture scan` first;
  the color belongs in the registry.
- A palette change request ("warmer", "more clinical") → check `mood list`
  before hand-editing tokens.
- Accessibility review of a themed UI → `tincture contrast` gives the
  per-surface matrix; a pair that passes on light can fail on dark.
- After ANY registry edit → `tincture codegen`, or consumers read stale output.

## The one hard rule

**A brand colour is surface-dependent. A single hex cannot serve both light
and dark.** The same `#0ea5e9` that reads as accent on a dark surface is
washed-out on light; "the brand blue" is a *matrix entry per surface*, never
a constant. If you find yourself pasting one hex into both halves of a theme,
stop — define the token with a `surface` axis and let codegen emit both.

## Known consumer

`meetsoma/repos/website` wires `tincture:codegen` and `tincture:scan` scripts
directly at `../../personal/tincture-css/core/src/cli/` — if `core/` moves
again, those two scripts break silently.
