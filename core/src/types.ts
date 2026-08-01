/**
 * Tincture v0.2 — multi-axis registry types.
 *
 * v0.1 modeled tokens as light/dark pairs (one axis: surface luminance).
 * v0.2 reframes tokens as VALUE MATRICES indexed by orthogonal axes:
 * brand-lock, surface, flavor, elevation, tone, mood.
 *
 * Each token declares which axes affect it and provides values for
 * each axis-cell that exists. Codegen emits one CSS cascade rule per
 * cell; mood deltas merge at cell level.
 *
 * See cycles/v02-scope.md for the full architecture.
 */

// ─────────────────────────────────────────────────────────────────────
// Axes
// ─────────────────────────────────────────────────────────────────────

/** All axes the substrate recognises. Order is conventional (least → most volatile). */
export type Axis = 'surface' | 'flavor' | 'tone' | 'elevation';

export const AXES = ['surface', 'flavor', 'tone', 'elevation'] as const;

/** Valid values per axis (closed set). Mood is intentionally open-ended and lives separately. */
export type AxisValueMap = {
  surface: 'light' | 'dark';
  flavor: 'cool' | 'warm' | 'ember';
  tone: 'feature' | 'prose' | 'surface' | 'brand-band';
  elevation: 'flat' | 'lifted' | 'dramatic';
};

export const AXIS_VALUES: { [K in Axis]: ReadonlyArray<AxisValueMap[K]> } = {
  surface: ['light', 'dark'],
  flavor: ['cool', 'warm', 'ember'],
  tone: ['feature', 'prose', 'surface', 'brand-band'],
  elevation: ['flat', 'lifted', 'dramatic'],
};

// ─────────────────────────────────────────────────────────────────────
// Token kinds
// ─────────────────────────────────────────────────────────────────────

/** What kind of value this token holds. Drives validation + codegen output. */
export type TokenKind =
  | 'color'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'motion'
  | 'brand-lock';

export const TOKEN_KINDS = [
  'color',
  'typography',
  'spacing',
  'radius',
  'shadow',
  'motion',
  'brand-lock',
] as const;

// ─────────────────────────────────────────────────────────────────────
// Axis-cell key
// ─────────────────────────────────────────────────────────────────────

/**
 * An axis-cell key identifies one cell of a token's value matrix.
 * Format: 'default' | 'axis=value' | 'axis=value,axis=value' (axes alphabetised)
 *
 * Examples:
 *   'default'                          — fallback / :root
 *   'surface=dark'                     — single axis
 *   'flavor=warm,surface=dark'         — compound (axes alphabetised, comma-separated)
 *
 * INVARIANT: axes appear at most once per key, alphabetised.
 */
export type AxisCellKey = string;

/**
 * Parse an axis-cell key into a structured form.
 * Returns null for malformed keys.
 */
export function parseAxisCellKey(key: AxisCellKey): Partial<AxisValueMap> | null {
  if (key === 'default') return {};
  const out: Record<string, string> = {};
  const parts = key.split(',');
  let prevAxis = '';
  for (const part of parts) {
    const m = part.match(/^([a-z\-]+)=([a-z\-]+)$/);
    if (!m) return null;
    const [, axis, value] = m;
    if (!(AXES as readonly string[]).includes(axis)) return null;
    if (out[axis]) return null; // duplicate axis
    if (axis < prevAxis) return null; // not alphabetised
    const valid = (AXIS_VALUES as Record<string, ReadonlyArray<string>>)[axis];
    if (!valid.includes(value)) return null;
    out[axis] = value;
    prevAxis = axis;
  }
  return out as Partial<AxisValueMap>;
}

/**
 * Serialise an axis-value object to canonical key form (alphabetised).
 */
export function serialiseAxisCellKey(av: Partial<AxisValueMap>): AxisCellKey {
  const entries = Object.entries(av).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 'default';
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([a, v]) => `${a}=${v}`).join(',');
}

// ─────────────────────────────────────────────────────────────────────
// Token definition
// ─────────────────────────────────────────────────────────────────────

/**
 * A single token in the registry. Has a kind, declares which axes
 * affect it, and provides values per axis-cell.
 *
 * Invariants (enforced by validator):
 *   1. Every key in `values` must be 'default' OR use only axes
 *      declared in `axes`.
 *   2. The 'default' cell is REQUIRED (fallback for :root).
 *   3. If `locked` is true, `axes` must be [] and only 'default' cell
 *      is allowed (brand-lock primitives).
 *   4. Compound keys (multiple axes) must use axes from `axes` only,
 *      alphabetised, no duplicates.
 */
export interface TokenDefinition {
  /** What kind of token this is (drives codegen). */
  kind: TokenKind;
  /** Which axes this token responds to. Empty array = invariant. */
  axes: Axis[];
  /** If true, mood deltas + manual overrides on this token are rejected. */
  locked?: boolean;
  /** Free-text description for designers + AI agents. */
  doc?: string;
  /**
   * Axis-cell key → value. 'default' is required; other cells are optional
   * (un-overridden cells fall back to default via cascade).
   */
  values: Record<AxisCellKey, string>;
}

// ─────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────

/**
 * Reusable named values referenced by tokens (e.g. brand colors, base
 * scales). Tokens can reference primitives via `{primitives.<group>.<name>}`
 * placeholder syntax in their `values`.
 *
 * Optional in v0.2 — tokens can use literal values directly.
 */
export interface PrimitiveDefinition {
  value: string;
  doc?: string;
}

export type Primitives = Record<string, Record<string, PrimitiveDefinition>>;

/**
 * Top-level registry shape. Versioned independently from package.json
 * to allow consumer registries to evolve at their own pace.
 */
export interface Registry {
  /** Schema version. v0.2.x = multi-axis. */
  version: string;
  /** Friendly name (e.g. "my-brand/tincture"). */
  name?: string;
  /** Free-text description. */
  doc?: string;
  /** Optional primitive groups (color, scale, etc.). */
  primitives?: Primitives;
  /** Tokens keyed by ID (which becomes the CSS custom property minus `--`). */
  tokens: Record<string, TokenDefinition>;
}

// ─────────────────────────────────────────────────────────────────────
// Mood delta (axis-aware)
// ─────────────────────────────────────────────────────────────────────

/**
 * A mood declares cell-level deltas over the registry. Engine merges
 * per-cell: mood values override registry values for that cell only;
 * cells the mood doesn't mention fall back to the registry.
 */
export interface MoodDefinition {
  id: string;
  name: string;
  doc?: string;
  base?: string; // informational; mood deltas don't chain
  /** Axis-default hints: when this mood is applied, prefer these axis values. */
  'axis-defaults'?: Partial<AxisValueMap>;
  /** Token deltas. Keys are token IDs. Cell-level overrides only. */
  tokens: Record<string, { values: Record<AxisCellKey, string> }>;
}
