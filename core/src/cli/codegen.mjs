#!/usr/bin/env node
/**
 * codegen.mjs — multi-axis Tincture codegen (canonical).
 *
 * Reads a v0.2 registry (validated via src/schema.mjs) and emits:
 *   - <out>/foundation.css   — cascade rules per axis-cell
 *   - <out>/manifest.json    — flat shape: { tokens[id]: { defaultValue, cells[] } }
 *   - <out>/tokens.d.ts      — TS union of token IDs
 *
 * Output is deterministic and byte-identical across runs (idempotent).
 *
 * Cascade strategy:
 *   - :root gets default value
 *   - [data-<axis>=<value>] selectors override per single-axis cell
 *   - Compound selectors [data-axis1=v1][data-axis2=v2] stack specificity
 *   - Order of emission: default → 1-axis → 2-axis → 3-axis (ascending)
 *
 * Flags: --runtime-moods | --no-runtime-moods override the registry's "runtime-moods" field.
 *
 * Run via CLI: tincture codegen
 *   Or direct: node src/cli/codegen.mjs --registry <path> --out <dir>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { validateRegistry } from '../schema.mjs';
import { emitFoundationCSS, emitManifest, emitTokenTypes, runtimeMoodsEnabled } from '../codegen-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATOR = 'tincture/codegen.mjs';

// ── arg parsing ─────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// Path resolution: --registry/--out flags → _resolve-config.mjs → defaults
let REGISTRY_PATH = arg('--registry');
let OUT_DIR = arg('--out');
if (!REGISTRY_PATH || !OUT_DIR) {
  try {
    const cfg = await import('./_resolve-config.mjs');
    if (!REGISTRY_PATH) REGISTRY_PATH = cfg.REGISTRY_PATH;
    if (!OUT_DIR) OUT_DIR = cfg.OUT_DIR;
  } catch {}
}
REGISTRY_PATH = resolve(REGISTRY_PATH ?? resolve(process.cwd(), 'tincture/registry.json'));
OUT_DIR = resolve(OUT_DIR ?? resolve(process.cwd(), 'tincture/_generated'));
const QUIET = process.argv.includes('--quiet');

// ── load + validate ─────────────────────────────────────────────────
const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const result = validateRegistry(reg);
if (!result.ok) {
  console.error(`✗ registry validation failed:`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ── emit (codegen-core.mjs owns the shape) ───────────────────────────
const opts = { generator: GENERATOR };
if (process.argv.includes('--runtime-moods')) opts.runtimeMoods = true;
if (process.argv.includes('--no-runtime-moods')) opts.runtimeMoods = false;

const foundation = emitFoundationCSS(reg, opts);
const manifest = emitManifest(reg, opts);
const tokenTypes = emitTokenTypes(reg, opts);

// ── write artifacts ──────────────────────────────────────────────────
function writeIfChanged(path, content) {
  let prev = '';
  try { prev = readFileSync(path, 'utf8'); } catch {}
  if (prev === content) {
    if (!QUIET) console.log(`  unchanged  ${basename(path)}`);
    return false;
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (!QUIET) console.log(`  written    ${basename(path)} (${content.length} bytes)`);
  return true;
}

let changed = 0;
if (writeIfChanged(resolve(OUT_DIR, 'foundation.css'), foundation)) changed++;
if (writeIfChanged(resolve(OUT_DIR, 'manifest.json'), manifest)) changed++;
if (writeIfChanged(resolve(OUT_DIR, 'tokens.d.ts'), tokenTypes)) changed++;

if (!QUIET) {
  if (runtimeMoodsEnabled(reg, opts)) console.log(`  runtime moods: ON (--mood-* indirection emitted)`);
  console.log(`\n${changed} file(s) changed.`);
}
process.exit(0);
