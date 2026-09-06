#!/usr/bin/env node
/**
 * Tincture v0.2 — multi-axis codegen.
 *
 * Reads a v0.2 registry (validated via src/schema.mjs) and emits:
 *   - <out>/foundation.css   — cascade rules per axis-cell, NO light-dark()
 *   - <out>/manifest.json    — flat shape: { tokens[id]: { defaultValue, cells[] } }
 *   - <out>/tokens.d.ts      — TS union of token IDs
 *
 * Output is deterministic and byte-identical across runs (idempotent).
 *
 * Cascade strategy (cycle 21 decision 8):
 *   - :root gets default value
 *   - [data-<axis>=<value>] selectors override per single-axis cell
 *   - Compound selectors [data-axis1=v1][data-axis2=v2] stack specificity
 *   - Order of emission: default → 1-axis → 2-axis → 3-axis (ascending),
 *     so higher-specificity rules come later and win on cascade ties
 *
 * Run:
 *   node src/cli/codegen-v2.mjs --registry path/to/registry.json --out path/to/_generated/
 *   node src/cli/codegen-v2.mjs (defaults to ../registry.example.json + ../_generated/)
 *
 * Cycle 22.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { validateRegistry } from '../schema.mjs';
import { emitFoundationCSS, emitManifest, emitTokenTypes, runtimeMoodsEnabled } from '../codegen-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATOR = 'tincture/codegen-v2.mjs';

// ── arg parsing ─────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const REGISTRY_PATH = resolve(arg('--registry', resolve(__dirname, '../registry.v02-example.json')));
const OUT_DIR = resolve(arg('--out', resolve(__dirname, '../_generated-v2')));
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
