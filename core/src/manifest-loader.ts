/**
 * tincture/manifest-loader.ts — cycle 6.
 *
 * Reads tincture/_generated/manifest.json (codegen output) and shapes
 * it for the designer studio's token-tree UI.
 *
 * The hand-curated TOKEN_GROUPS that previously lived in the studio page
 * was the auditor's #1 finding (9 of 10 defaults stale). This file
 * replaces it with manifest-driven groups that are correct-by-construction.
 *
 * The manifest is checked in (cycle 4 Q5 decision) so this import works
 * at build time without any fetch ceremony.
 */

import manifest from './_generated/manifest.json';

export type TokenManifestEntry = {
  type: 'color' | string;
  lightValue: string;
  darkValue: string;
  doc: string;
  role: string | null;
  contrastPair: string | null;
  legacy: string[];
};

export type TokenGroup = {
  group: string;
  tokens: Array<{
    token: string;       // the css var name e.g. --ink
    label: string;       // human label
    defaultLight: string;
    defaultDark: string;
    doc: string;
    legacy: string[];
  }>;
};

// ── Group tokens by role family ────────────────────────────────────────
const GROUP_OF_ROLE: Record<string, string> = {
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

export function buildTokenGroups(): TokenGroup[] {
  const tokens = manifest.tokens as Record<string, TokenManifestEntry>;
  const groups: Record<string, TokenGroup['tokens']> = {};

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

function prettyLabel(id: string): string {
  // ink-soft → 'Ink soft', accent-warm → 'Accent warm'
  return id
    .split('-')
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');
}

export function getManifest() {
  return manifest;
}

export function getFlavorOverrides(flavor: string) {
  return (manifest.flavors as any)?.[flavor]?.overrides ?? {};
}

export function getComponentManifest(name: string) {
  return (manifest.components as any)?.[name] ?? null;
}

export const tinctureVersion = manifest.version;
