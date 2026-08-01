/**
 * tincture/manifest-loader.mjs — runtime entry (JS mirror of manifest-loader.ts).
 *
 * Hand-written .mjs so the package entry loads for plain consumers:
 * Node refuses to strip types under node_modules, so a .ts `main` throws
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING on install. Types for this
 * module live in manifest-loader.ts (kept for editors) and the generated
 * tokens.d.ts pointed at by package.json "types".
 *
 * Reads tincture/_generated/manifest.json (codegen output) and shapes
 * it for the designer studio's token-tree UI. The manifest is checked in
 * (cycle 4 Q5 decision) so this loads at build time without any fetch
 * ceremony. JSON is loaded via createRequire — works on all Node >=18
 * (import attributes would demand >=18.20).
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('./_generated/manifest.json');

// ── Group tokens by role family ────────────────────────────────────────
const GROUP_OF_ROLE = {
  'text-primary':   'Text',
  'text-secondary': 'Text',
  'text-tertiary':  'Text',
  'ink-on-accent':  'Text',
  'surface-page':       'Backgrounds',
  'surface-card':       'Backgrounds',
  'surface-elevated':   'Backgrounds',
  'accent-primary': 'Accents',
  'accent-warm':    'Accents',
  'border-default': 'Borders',
  'border-subtle':  'Borders',
};

const GROUPS_ORDER = ['Text', 'Backgrounds', 'Accents', 'Borders', 'Other'];

export function buildTokenGroups() {
  const tokens = manifest.tokens;
  const groups = {};

  for (const [id, entry] of Object.entries(tokens)) {
    const groupName = GROUP_OF_ROLE[entry.role ?? ''] ?? 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push({
      token: `--${id}`,
      label: prettyLabel(id),
      defaultLight: entry.lightValue,
      defaultDark: entry.darkValue,
      doc: entry.doc,
      legacy: entry.legacy ?? [],
    });
  }

  return GROUPS_ORDER
    .filter((g) => groups[g])
    .map((g) => ({ group: g, tokens: groups[g] }));
}

function prettyLabel(id) {
  // ink-soft → 'Ink soft', accent-warm → 'Accent warm'
  return id
    .split('-')
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');
}

export function getManifest() {
  return manifest;
}

export function getFlavorOverrides(flavor) {
  return manifest.flavors?.[flavor]?.overrides ?? {};
}

export function getComponentManifest(name) {
  return manifest.components?.[name] ?? null;
}

export const tinctureVersion = manifest.version;
