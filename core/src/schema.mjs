/**
 * Tincture v0.2 — runtime schema validator (JS mirror of types.ts).
 *
 * Validates that a registry conforms to the multi-axis schema:
 *   - Every token has a known `kind`
 *   - Every token's `axes` is a subset of the global AXES list
 *   - Every key in `values` is 'default' or a well-formed axis-cell key
 *   - Every axis-cell key uses only axes declared in the token's `axes`
 *   - 'default' cell is required
 *   - Locked tokens have axes=[] + only 'default' cell
 *
 * Run: `node src/schema.mjs <path-to-registry.json>` (CLI)
 *      or import { validateRegistry } and call programmatically.
 */

export const AXES = ['surface', 'flavor', 'tone', 'elevation'];

export const AXIS_VALUES = {
  surface: ['light', 'dark'],
  flavor: ['cool', 'warm', 'ember'],
  tone: ['feature', 'prose', 'surface', 'brand-band'],
  elevation: ['flat', 'lifted', 'dramatic'],
};

export const TOKEN_KINDS = [
  'color',
  'typography',
  'spacing',
  'radius',
  'shadow',
  'motion',
  'brand-lock',
];

/** Parse 'default' | 'axis=value[,axis=value]' into structured form, or null. */
export function parseAxisCellKey(key) {
  if (key === 'default') return {};
  const out = {};
  const parts = key.split(',');
  let prevAxis = '';
  for (const part of parts) {
    const m = part.match(/^([a-z\-]+)=([a-z\-]+)$/);
    if (!m) return null;
    const [, axis, value] = m;
    if (!AXES.includes(axis)) return null;
    if (out[axis] !== undefined) return null;
    if (axis < prevAxis) return null;
    if (!AXIS_VALUES[axis].includes(value)) return null;
    out[axis] = value;
    prevAxis = axis;
  }
  return out;
}

export function serialiseAxisCellKey(av) {
  const entries = Object.entries(av).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 'default';
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([a, v]) => `${a}=${v}`).join(',');
}

/**
 * Validate a registry. Returns { ok, errors } — never throws on input.
 *
 * @param {unknown} reg  Parsed JSON object (untrusted)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRegistry(reg) {
  const errors = [];

  if (!reg || typeof reg !== 'object') {
    return { ok: false, errors: ['registry must be an object'] };
  }

  if (typeof reg.version !== 'string' || !reg.version) {
    errors.push('registry.version must be a non-empty string');
  }

  if (!reg.tokens || typeof reg.tokens !== 'object') {
    return { ok: false, errors: [...errors, 'registry.tokens must be an object'] };
  }

  for (const [tokenId, tok] of Object.entries(reg.tokens)) {
    const ctx = `tokens.${tokenId}`;

    if (!tok || typeof tok !== 'object') {
      errors.push(`${ctx} must be an object`);
      continue;
    }

    // kind
    if (!TOKEN_KINDS.includes(tok.kind)) {
      errors.push(`${ctx}.kind must be one of [${TOKEN_KINDS.join(', ')}], got ${JSON.stringify(tok.kind)}`);
    }

    // axes
    if (!Array.isArray(tok.axes)) {
      errors.push(`${ctx}.axes must be an array`);
      continue;
    }
    const seenAxes = new Set();
    for (const axis of tok.axes) {
      if (!AXES.includes(axis)) {
        errors.push(`${ctx}.axes contains unknown axis ${JSON.stringify(axis)} — must be one of [${AXES.join(', ')}]`);
      }
      if (seenAxes.has(axis)) {
        errors.push(`${ctx}.axes has duplicate axis ${JSON.stringify(axis)}`);
      }
      seenAxes.add(axis);
    }

    // values
    if (!tok.values || typeof tok.values !== 'object') {
      errors.push(`${ctx}.values must be an object`);
      continue;
    }
    if (tok.values.default === undefined) {
      errors.push(`${ctx}.values must include a 'default' cell`);
    }

    // locked tokens have stricter rules
    if (tok.locked) {
      if (tok.axes.length !== 0) {
        errors.push(`${ctx} is locked but has axes — locked tokens must have axes: []`);
      }
      const cellKeys = Object.keys(tok.values);
      if (cellKeys.length !== 1 || cellKeys[0] !== 'default') {
        errors.push(`${ctx} is locked but has cells other than 'default' — locked tokens accept only the default cell`);
      }
    }

    // each cell key valid + uses only declared axes
    for (const cellKey of Object.keys(tok.values)) {
      const parsed = parseAxisCellKey(cellKey);
      if (parsed === null) {
        errors.push(`${ctx}.values["${cellKey}"] — malformed axis-cell key (expected 'default' or axis=value, axis=value alphabetised)`);
        continue;
      }
      // All axes used in this cell must be declared in the token's axes
      for (const axis of Object.keys(parsed)) {
        if (!tok.axes.includes(axis)) {
          errors.push(`${ctx}.values["${cellKey}"] references axis ${JSON.stringify(axis)} which is not declared in ${ctx}.axes (declared: [${tok.axes.join(', ')}])`);
        }
      }
      // Cell value must be a string
      const val = tok.values[cellKey];
      if (typeof val !== 'string' || val.length === 0) {
        errors.push(`${ctx}.values["${cellKey}"] must be a non-empty string`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a mood JSON. Same axis-cell key rules; mood deltas can only
 * touch tokens that exist in the registry.
 */
export function validateMood(mood, registry) {
  const errors = [];
  if (!mood || typeof mood !== 'object') return { ok: false, errors: ['mood must be an object'] };
  if (typeof mood.id !== 'string' || !mood.id) errors.push('mood.id must be a non-empty string');
  if (typeof mood.name !== 'string' || !mood.name) errors.push('mood.name must be a non-empty string');
  if (mood.tokens && typeof mood.tokens !== 'object') errors.push('mood.tokens must be an object');

  if (mood.tokens && registry?.tokens) {
    for (const [tokenId, delta] of Object.entries(mood.tokens)) {
      const ctx = `mood.tokens.${tokenId}`;
      const regTok = registry.tokens[tokenId];
      if (!regTok) {
        errors.push(`${ctx} — token does not exist in registry`);
        continue;
      }
      if (regTok.locked) {
        errors.push(`${ctx} — token is locked (brand-lock primitive); moods cannot override`);
        continue;
      }
      if (!delta.values || typeof delta.values !== 'object') {
        errors.push(`${ctx}.values must be an object`);
        continue;
      }
      for (const cellKey of Object.keys(delta.values)) {
        const parsed = parseAxisCellKey(cellKey);
        if (parsed === null) {
          errors.push(`${ctx}.values["${cellKey}"] — malformed axis-cell key`);
          continue;
        }
        for (const axis of Object.keys(parsed)) {
          if (!regTok.axes.includes(axis)) {
            errors.push(`${ctx}.values["${cellKey}"] uses axis ${JSON.stringify(axis)} which is not declared on the registry token`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── CLI ────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node src/schema.mjs <registry.json> [<mood.json>]');
    process.exit(2);
  }
  const reg = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = validateRegistry(reg);
  if (result.ok) {
    console.log(`✓ registry valid (${Object.keys(reg.tokens).length} tokens)`);
  } else {
    console.error(`✗ registry invalid:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (process.argv[3]) {
    const mood = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const moodResult = validateMood(mood, reg);
    if (moodResult.ok) {
      console.log(`✓ mood valid (${Object.keys(mood.tokens || {}).length} token deltas)`);
    } else {
      console.error(`✗ mood invalid:`);
      for (const e of moodResult.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
  }
}
