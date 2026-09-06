/**
 * runtime/mood.mjs — apply a tincture mood at RUNTIME, no build.
 *
 * Requires a foundation generated with `"runtime-moods": true` (every unlocked token is
 * `--id: var(--mood-id, <value>)`). Then a mood is just a set of `--mood-*` custom properties
 * placed on an ancestor; the foundation's own cells keep resolving underneath it, so nested
 * `[data-surface]` blocks do not stomp the mood.
 *
 * Three ways in, one mood shape:
 *   moodVars(mood, axes)   → { '--mood-ink': '#fff', … }  for ONE axis cell — a React `style`
 *                            prop, an inline `style=""`, an SSR <html style>. This is how a
 *                            server layout that already knows the surface applies a mood.
 *   moodCss(mood, opts)    → a CSS string with one block per cell under a selector
 *                            (default `[data-mood="<id>"]`) — ship it in a <style>, or write
 *                            it to a file. Covers EVERY cell, so it is the right form when the
 *                            subtree switches surfaces underneath the wrapper.
 *   applyMood(el, mood, axes) / clearMood(el, mood) → DOM: set/remove the vars on an element.
 *
 * Accepted mood shapes (both validated by schema.validateMood at build time, not here):
 *   v0.2  { id, tokens: { <id>: { values: { default?, "surface=dark"?, … } } } }
 *   v0.1  { id, tokens: { <id>: { lightValue, darkValue } } }   → default + surface=dark
 *
 * A mood with no tokens is the `neutral` mood: every var() takes its fallback, output is
 * byte-identical to the un-mooded foundation. That is the contract the dashboard's
 * `neutral` = visual no-op gate rests on.
 *
 * No DOM access except inside applyMood/clearMood; safe to import server-side.
 */

const MOOD_PREFIX = '--mood-';

/** Parse a cell key into { axis: value } (or {} for 'default'). Mirrors schema.parseAxisCellKey. */
function parseCell(key) {
  if (key === 'default') return {};
  const out = {};
  for (const part of key.split(',')) {
    const [axis, value] = part.split('=');
    out[axis] = value;
  }
  return out;
}

/** Cell keys sorted default → 1-axis → 2-axis, alpha within — the codegen order. */
function sortCellKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    const ca = a.split(',').length;
    const cb = b.split(',').length;
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });
}

/**
 * Normalise a mood to { id, tokens: { <id>: { <cellKey>: value } } }.
 * v0.1 `lightValue`/`darkValue` become `default` / `surface=dark`.
 */
export function normalizeMood(mood) {
  if (!mood || typeof mood !== 'object') throw new TypeError('mood must be an object');
  const tokens = {};
  for (const [id, delta] of Object.entries(mood.tokens || {})) {
    if (!delta || typeof delta !== 'object') continue;
    const cells = {};
    if (delta.values && typeof delta.values === 'object') {
      for (const [cell, value] of Object.entries(delta.values)) {
        if (value !== undefined && value !== null) cells[cell] = String(value);
      }
    }
    if (delta.lightValue !== undefined) cells.default = String(delta.lightValue);
    if (delta.darkValue !== undefined) cells['surface=dark'] = String(delta.darkValue);
    if (Object.keys(cells).length) tokens[id] = cells;
  }
  return { id: mood.id, tokens };
}

/** Does every axis in the cell match the axes we are resolving for? */
function cellMatches(cellKey, axes) {
  const parsed = parseCell(cellKey);
  return Object.entries(parsed).every(([axis, value]) => axes[axis] === value);
}

/**
 * Resolve the mood for ONE axis cell.
 * @param {object} mood
 * @param {Record<string,string>} axes  e.g. { surface: 'dark' }
 * @returns {Record<string,string>}  { '--mood-<id>': value }
 */
export function moodVars(mood, axes = {}) {
  const { tokens } = normalizeMood(mood);
  const out = {};
  for (const [id, cells] of Object.entries(tokens)) {
    // Most specific matching cell wins; sortCellKeys puts specific last, so the last match wins.
    let pick;
    for (const key of sortCellKeys(Object.keys(cells))) {
      if (cellMatches(key, axes)) pick = cells[key];
    }
    if (pick !== undefined) out[`${MOOD_PREFIX}${id}`] = pick;
  }
  return out;
}

/**
 * Emit the mood as CSS: one block per cell under `selector`.
 * Non-default cells are emitted twice — on the wrapper itself and on descendants — so a
 * wrapper that IS the surfaced element and one that CONTAINS surfaced blocks both work.
 * @param {object} mood
 * @param {{ selector?: string, attributes?: Record<string,string> }} [opts]
 *   selector — default `[data-mood="<id>"]`; attributes — the registry's `axis-attributes`
 *   (e.g. `{ surface: 'data-theme' }`), so the blocks key on the same attribute the foundation does.
 */
export function moodCss(mood, opts = {}) {
  const { id, tokens } = normalizeMood(mood);
  const selector = opts.selector || `[data-mood="${id}"]`;
  const attributes = opts.attributes || {};
  const byCell = new Map(); // cellKey → [[id, value]]
  for (const [tokenId, cells] of Object.entries(tokens)) {
    for (const [cell, value] of Object.entries(cells)) {
      if (!byCell.has(cell)) byCell.set(cell, []);
      byCell.get(cell).push([tokenId, value]);
    }
  }
  const lines = [`/* tincture mood: ${id} */`];
  for (const cell of sortCellKeys([...byCell.keys()])) {
    const attrs = Object.entries(parseCell(cell)).map(([a, v]) => `[${attributes[a] || `data-${a}`}="${v}"]`).join('');
    const sel = cell === 'default' ? selector : `${selector}${attrs}, ${selector} ${attrs}`;
    lines.push(`${sel} {`);
    for (const [tokenId, value] of byCell.get(cell).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  ${MOOD_PREFIX}${tokenId}: ${value};`);
    }
    lines.push(`}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Set the mood's vars on a DOM element for the given axes. Returns the vars applied.
 * Clears any `--mood-*` this mood previously set that it no longer sets.
 */
export function applyMood(el, mood, axes = {}) {
  if (!el || typeof el.style?.setProperty !== 'function') throw new TypeError('applyMood: el must be a DOM element');
  const vars = moodVars(mood, axes);
  clearMood(el, mood);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  if (mood.id) el.setAttribute('data-mood', mood.id);
  return vars;
}

/** Remove every `--mood-*` var this mood could have set, and the data-mood attribute. */
export function clearMood(el, mood) {
  if (!el || typeof el.style?.removeProperty !== 'function') throw new TypeError('clearMood: el must be a DOM element');
  const { id, tokens } = normalizeMood(mood);
  for (const tokenId of Object.keys(tokens)) el.style.removeProperty(`${MOOD_PREFIX}${tokenId}`);
  if (id && el.getAttribute?.('data-mood') === id) el.removeAttribute('data-mood');
}
