#!/usr/bin/env node
/**
 * Tincture — migrate a v0.1 registry to v0.2 (axis-aware) shape.
 *
 * v0.1 shape:
 *   semantic.<id> = { type, doc, lightValue, darkValue, role?, legacy? }
 *   primitives.<group>.<name> = { value, doc? }
 *
 * v0.2 shape:
 *   tokens.<id> = { kind, axes[], values: { default, "surface=dark"?, ... }, locked? }
 *   primitives unchanged
 *
 * Mapping:
 *   - semantic.<id>.lightValue → tokens.<id>.values.default (ALWAYS present)
 *   - semantic.<id>.darkValue (if differs from lightValue)
 *       → tokens.<id>.values["surface=dark"]
 *       AND axes: ['surface']
 *   - semantic.<id>.darkValue (same as lightValue)
 *       → omitted; token is surface-invariant; axes: []
 *   - kind inferred from id name + value pattern (color | typography | spacing |
 *     radius | shadow | motion | brand-lock):
 *       * brand-mark-* → 'brand-lock' + locked: true
 *       * weight-*, font-*, type-*, leading-*, track-* → 'typography'
 *       * space-*, gap-* → 'spacing'
 *       * radius-* → 'radius'
 *       * shadow-* → 'shadow'
 *       * motion-*, duration-* → 'motion'
 *       * everything else → 'color'
 *   - role/legacy fields: dropped (they were v0.1 metadata that v0.2 doesn't use;
 *     v0.2 reverse-lookup uses the manifest)
 *
 * Mood migration (separate function, called per mood file):
 *   v0.1 mood.tokens.<id> = { lightValue?, darkValue? }
 *   v0.2 mood.tokens.<id> = { values: { default?: lightValue, "surface=dark"?: darkValue } }
 *
 * Run:
 *   node src/cli/migrate-v01-to-v02.mjs --in <path> --out <path>
 *   node src/cli/migrate-v01-to-v02.mjs --in registry.json --out registry.v02.json
 *   (default: --in src/registry.example.json --out src/registry.example.v02.json)
 *
 * Cycle 23.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateRegistry } from '../schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const IN_PATH = resolve(arg('--in', resolve(process.cwd(), 'registry.json')));
const OUT_PATH = resolve(arg('--out', resolve(process.cwd(), 'registry.v02.json')));
const BACKUP = process.argv.includes('--backup');
const QUIET = process.argv.includes('--quiet');

// ─── kind inference ────────────────────────────────────────────────
export function inferKind(tokenId, value) {
  if (/^brand-mark-/.test(tokenId)) return 'brand-lock';
  if (/^(weight|font|type|leading|track)-/.test(tokenId)) return 'typography';
  if (/^(space|gap)-/.test(tokenId)) return 'spacing';
  if (/^radius-/.test(tokenId)) return 'radius';
  if (/^shadow-/.test(tokenId)) return 'shadow';
  if (/^(motion|duration)-/.test(tokenId)) return 'motion';
  return 'color';
}

// ─── resolve {primitives.x.y} placeholder ──────────────────────────
function resolvePrimitive(value, primitives) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^\{primitives\.([^.]+)\.([^}]+)\}$/);
  if (!m) return value;
  const [, group, name] = m;
  return primitives?.[group]?.[name]?.value ?? value;
}

// ─── migrate registry ──────────────────────────────────────────────
export function migrateRegistry(v01) {
  const tokens = {};
  const semantic = v01.semantic || {};
  const primitives = v01.primitives || {};

  for (const [id, def] of Object.entries(semantic)) {
    const light = resolvePrimitive(def.lightValue, primitives);
    const dark = resolvePrimitive(def.darkValue, primitives);

    // If lightValue/darkValue resolve identically, no surface axis
    const surfaceAware = dark !== undefined && dark !== light;

    const kind = inferKind(id, light);
    const isLocked = kind === 'brand-lock';

    const values = { default: light };
    if (surfaceAware && !isLocked) {
      values['surface=dark'] = dark;
    }

    tokens[id] = {
      kind,
      axes: surfaceAware && !isLocked ? ['surface'] : [],
      ...(isLocked ? { locked: true } : {}),
      ...(def.doc ? { doc: def.doc } : {}),
      values,
    };
  }

  return {
    version: bumpVersion(v01.version),
    name: v01.name,
    doc: v01.doc,
    primitives,
    tokens,
  };
}

function bumpVersion(v01Version) {
  // 0.1.x → 0.2.0; preserves any pre-release suffix
  if (!v01Version) return '0.2.0';
  const m = v01Version.match(/^0\.1\.(\d+)(.*)$/);
  if (!m) return '0.2.0';
  return `0.2.0${m[2]}`;
}

// ─── migrate mood JSON ─────────────────────────────────────────────
export function migrateMood(v01Mood, v02Registry) {
  const tokens = {};
  for (const [id, delta] of Object.entries(v01Mood.tokens || {})) {
    const values = {};
    if (delta.lightValue !== undefined) values.default = delta.lightValue;
    if (delta.darkValue !== undefined && delta.darkValue !== delta.lightValue) {
      // Only emit surface=dark if registry token declares surface axis
      const tok = v02Registry?.tokens?.[id];
      if (!tok || tok.axes.includes('surface')) {
        values['surface=dark'] = delta.darkValue;
      }
    }
    if (Object.keys(values).length > 0) {
      tokens[id] = { values };
    }
  }
  return {
    id: v01Mood.id,
    name: v01Mood.name,
    doc: v01Mood.doc,
    base: v01Mood.base,
    'axis-defaults': v01Mood['axis-defaults'],
    tokens,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const v01 = JSON.parse(readFileSync(IN_PATH, 'utf8'));
  const v02 = migrateRegistry(v01);

  // Validate the output
  const result = validateRegistry(v02);
  if (!result.ok) {
    console.error(`✗ migrated registry failed validation:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Backup the input
  if (BACKUP && existsSync(IN_PATH)) {
    copyFileSync(IN_PATH, IN_PATH + '.v01-bak');
    if (!QUIET) console.log(`  backup     ${IN_PATH}.v01-bak`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(v02, null, 2) + '\n');
  if (!QUIET) {
    console.log(`✓ migrated ${Object.keys(v01.semantic || {}).length} tokens v0.1 → v0.2`);
    console.log(`  output:    ${OUT_PATH}`);
    console.log(`  version:   ${v01.version} → ${v02.version}`);
    const surfaceAware = Object.values(v02.tokens).filter(t => t.axes.includes('surface')).length;
    const locked = Object.values(v02.tokens).filter(t => t.locked).length;
    console.log(`  surface-aware: ${surfaceAware} / ${Object.keys(v02.tokens).length}`);
    console.log(`  locked:        ${locked}`);
  }
}
