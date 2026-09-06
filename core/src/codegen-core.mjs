/**
 * codegen-core.mjs — the multi-axis emitters, shared by codegen.mjs and codegen-v2.mjs.
 *
 * Pure functions: registry in, strings out. The two CLI files differ only in how they
 * resolve paths; everything that decides what the CSS LOOKS like lives here, once.
 *
 * Emits:
 *   - foundation.css — cascade rules per axis-cell
 *   - manifest.json  — flat shape: { tokens[id]: { defaultValue, cells[] } }
 *   - tokens.d.ts    — TS union of token IDs
 *
 * Output is deterministic and byte-identical across runs (idempotent).
 *
 * Cascade strategy:
 *   - :root gets default value
 *   - [data-<axis>=<value>] selectors override per single-axis cell
 *   - Compound selectors [data-axis1=v1][data-axis2=v2] stack specificity
 *   - Order of emission: default → 1-axis → 2-axis → 3-axis (ascending),
 *     so higher-specificity rules come later and win on cascade ties
 *
 * Runtime moods (registry `"runtime-moods": true`, or option `{ runtimeMoods: true }`):
 *   every unlocked token is emitted as `--id: var(--mood-id, <value>)` in EVERY cell, so a
 *   `--mood-id` set on any ancestor (inline style, `[data-mood]` block, applyMood()) re-lights
 *   the subtree without a build and without being stomped by a nested `[data-surface]` block.
 *   This is the `surface-extensions.css` bridge that consumers hand-copied, now owned by the
 *   generator. Locked (brand-lock) tokens stay raw — moods may not override them, so there is
 *   no indirection to offer. Off by default: existing consumers' output is unchanged.
 */

import { AXES } from './schema.mjs';

/** Parse a cell key into ordered [axis, value] pairs (or [] for default). */
export function parseCell(key) {
  if (key === 'default') return [];
  return key.split(',').map(p => p.split('='));
}

/**
 * The HTML attribute an axis is read from. Default `data-<axis>`; a registry may alias one
 * (`"axis-attributes": { "surface": "data-theme" }`) so an app that already switches on
 * another attribute adopts the foundation without renaming its switch.
 */
export function axisAttribute(axis, attributes = {}) {
  return attributes[axis] || `data-${axis}`;
}

/** Selector for a cell key. 'default' → ':root'; axes → '[data-X="Y"][data-W="Z"]'. */
export function cellSelector(key, attributes = {}) {
  if (key === 'default') return ':root';
  return parseCell(key).map(([a, v]) => `[${axisAttribute(a, attributes)}="${v}"]`).join('');
}

/** Sort cell keys: default first, then by axis count ascending, then alpha. */
export function sortCellKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    const ca = a.split(',').length;
    const cb = b.split(',').length;
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });
}

/** Which surface the DEFAULT cell's values are tuned for: registry `default-surface`, else light. */
export function defaultSurfaceOf(reg) {
  const v = reg['default-surface'];
  if (v === undefined) return 'light';
  if (v !== 'light' && v !== 'dark') throw new Error(`registry.default-surface must be "light" or "dark", got ${JSON.stringify(v)}`);
  return v;
}

/** Whether a registry (or explicit option) asks for the --mood-* indirection. */
export function runtimeMoodsEnabled(reg, opts = {}) {
  if (typeof opts.runtimeMoods === 'boolean') return opts.runtimeMoods;
  return reg['runtime-moods'] === true;
}

// Auto-fill axis-value reset cells.
//
// Why: cascade composition is broken if a token declares axis=X with only SOME values
// present. E.g. token `--ink` has axes:['surface'] and values { default, 'surface=dark' }:
//   :root                  { --ink: #1A1612 }
//   [data-surface="dark"]  { --ink: #fff }
//   [data-surface="light"] { /* empty — NO --ink override */ }
// A [data-surface="light"] nested inside a dark ancestor inherits #fff instead of resetting.
// Fix: for every token T with axes A, for every value V of every axis in A, ensure T has a
// value at the single-axis cell, filled from the default.
const AXIS_VALUES_RUNTIME = {
  surface: ['light', 'dark'],
  flavor: ['cool', 'warm', 'ember'],
  tone: ['feature', 'prose', 'surface', 'brand-band'],
  elevation: ['flat', 'lifted', 'dramatic'],
};

function autoFillToken(tok) {
  if (tok.axes.length === 0) return tok.values;
  const filled = { ...tok.values };
  for (const axis of tok.axes) {
    for (const value of AXIS_VALUES_RUNTIME[axis] || []) {
      const cellKey = `${axis}=${value}`;
      if (filled[cellKey] === undefined) filled[cellKey] = filled.default;
    }
  }
  return filled;
}

/** The CSS value for one token in one cell — raw, or wrapped in the mood indirection. */
export function tokenDeclaration(id, value, { locked = false, runtimeMoods = false } = {}) {
  if (runtimeMoods && !locked) return `--${id}: var(--mood-${id}, ${value});`;
  return `--${id}: ${value};`;
}

// ── foundation.css ───────────────────────────────────────────────────
export function emitFoundationCSS(reg, opts = {}) {
  const runtimeMoods = runtimeMoodsEnabled(reg, opts);
  const attributes = reg['axis-attributes'] || {};
  const defaultSurface = defaultSurfaceOf(reg);
  const generator = opts.generator || 'tincture/codegen.mjs';
  const lines = [];
  lines.push(`/* GENERATED by ${generator} — do not edit by hand. */`);
  lines.push(`/* Registry: ${reg.name || '(unnamed)'} v${reg.version} */`);
  lines.push(`/* Run: pnpm tincture:codegen */`);
  if (runtimeMoods) {
    lines.push(`/* Runtime moods: every unlocked token resolves through var(--mood-<id>, <value>). */`);
    lines.push(`/* Set --mood-<id> on any ancestor (inline, [data-mood] block, applyMood()) to re-light a subtree. */`);
  }
  lines.push(``);

  // Group tokens per unique cellKey → one CSS block per cell (denser, uniform specificity).
  const cellGroups = new Map(); // cellKey → [{ id, value, doc, locked }]
  for (const [tokenId, tok] of Object.entries(reg.tokens)) {
    const filled = autoFillToken(tok);
    for (const [cellKey, value] of Object.entries(filled)) {
      if (!cellGroups.has(cellKey)) cellGroups.set(cellKey, []);
      cellGroups.get(cellKey).push({ id: tokenId, value, doc: tok.doc, locked: !!tok.locked });
    }
  }

  for (const cellKey of sortCellKeys([...cellGroups.keys()])) {
    const tokens = cellGroups.get(cellKey);
    const selector = cellSelector(cellKey, attributes);

    lines.push(cellKey === 'default' ? `/* :root — default values for every token. */` : `/* ${cellKey} */`);
    lines.push(`${selector} {`);

    // The surface axis also owns color-scheme. The DEFAULT cell's scheme follows the registry's
    // `default-surface` (light unless declared) — an app whose :root holds its dark values must say
    // so, or :root carries dark colours under a light scheme (dark chassis, light form controls).
    if (cellKey === 'default') lines.push(`  color-scheme: ${defaultSurface};`);
    else if (cellKey === 'surface=dark') lines.push(`  color-scheme: dark;`);
    else if (cellKey === 'surface=light') lines.push(`  color-scheme: light;`);

    const sortedTokens = [...tokens].sort((a, b) => a.id.localeCompare(b.id));
    for (const t of sortedTokens) {
      if (cellKey === 'default' && t.doc) lines.push(`  /* ${t.doc} */`);
      lines.push(`  ${tokenDeclaration(t.id, t.value, { locked: t.locked, runtimeMoods })}`);
    }

    if (cellKey === 'default') {
      lines.push(``);
      lines.push(`  --tincture-foundation-version: "${reg.version}";`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  return lines.join('\n');
}

// ── manifest.json ────────────────────────────────────────────────────
export function emitManifest(reg, opts = {}) {
  const runtimeMoods = runtimeMoodsEnabled(reg, opts);
  const attributes = reg['axis-attributes'] || {};
  const tokens = {};
  for (const [tokenId, tok] of Object.entries(reg.tokens).sort(([a], [b]) => a.localeCompare(b))) {
    tokens[tokenId] = {
      kind: tok.kind,
      axes: tok.axes,
      locked: !!tok.locked,
      doc: tok.doc || '',
      defaultValue: tok.values.default,
      cells: sortCellKeys(Object.keys(tok.values)).map(key => ({
        cell: key,
        value: tok.values[key],
        selector: cellSelector(key, attributes),
      })),
    };
  }
  return JSON.stringify({
    schemaVersion: '2.0',
    registry: {
      version: reg.version,
      name: reg.name || null,
      doc: reg.doc || null,
      // Only present when on, so a consumer that never opted in gets a byte-identical manifest.
      ...(runtimeMoods ? { runtimeMoods: true } : {}),
      ...(Object.keys(attributes).length ? { axisAttributes: attributes } : {}),
      ...(reg['default-surface'] ? { defaultSurface: reg['default-surface'] } : {}),
    },
    axes: AXES,
    tokens,
  }, null, 2) + '\n';
}

// ── tokens.d.ts ──────────────────────────────────────────────────────
export function emitTokenTypes(reg, opts = {}) {
  const generator = opts.generator || 'tincture/codegen.mjs';
  const ids = Object.keys(reg.tokens).sort();
  const union = ids.length === 0 ? 'never' : ids.map(id => JSON.stringify(id)).join(' | ');
  return [
    `// GENERATED by ${generator} — do not edit by hand.`,
    `// Registry: ${reg.name || '(unnamed)'} v${reg.version}`,
    ``,
    `/** Union of every token ID in the registry. */`,
    `export type TokenId = ${union};`,
    ``,
    `/** All token IDs as a tuple (use \`as const\` for inference). */`,
    `export const TOKEN_IDS = [${ids.map(id => JSON.stringify(id)).join(', ')}] as const;`,
    ``,
  ].join('\n');
}
