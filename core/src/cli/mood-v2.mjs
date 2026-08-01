#!/usr/bin/env node
/**
 * tincture-mood-v2.mjs — Tincture v0.2 mood engine.
 *
 * Reads a v0.2 registry + a v0.2 mood JSON; merges mood cells into the
 * registry's tokens.<id>.values map; writes back; regenerates CSS.
 *
 * Mood shape (v0.2):
 *   { id, name, doc, axis-defaults?, tokens: {
 *       <id>: { values: { default?: X, "surface=dark"?: Y, ... } }
 *     }}
 *
 * Apply rules:
 *   - Mood cell overrides registry cell at the same key
 *   - Cells the mood doesn't mention are LEFT UNCHANGED on the registry
 *   - Mood cannot touch brand-lock tokens (validator rejects)
 *   - Mood cannot use axis values not declared on the registry token
 *
 * Usage:
 *   tincture-mood-v2 list
 *   tincture-mood-v2 preview <name>      — show diff vs current registry
 *   tincture-mood-v2 apply <name>        — write changes to registry + regen
 *   tincture-mood-v2 reset               — restore baseline (default)
 *
 * Cycle 26.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { validateRegistry, validateMood } from '../schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd(); // consumer project root
import { REGISTRY_PATH as REG_PATH, MOODS_DIR, BASELINE_PATH, OUT_DIR } from './_resolve-config.mjs';


const CODEGEN = resolve(__dirname, 'codegen-v2.mjs'); // sibling script

function loadMood(name) {
  const p = join(MOODS_DIR, `${name}.json`);
  if (!existsSync(p)) {
    console.error(`✗ mood not found: ${name}`);
    console.error(`  available: ${readdirSync(MOODS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).join(', ')}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadReg() {
  return JSON.parse(readFileSync(REG_PATH, 'utf8'));
}

function diffCells(regCells, moodCells) {
  const lines = [];
  for (const [cellKey, moodVal] of Object.entries(moodCells)) {
    const regVal = regCells[cellKey];
    if (regVal === moodVal) continue;
    if (regVal === undefined) {
      lines.push(`  + ${cellKey} = ${moodVal}`);
    } else {
      lines.push(`  ~ ${cellKey} : ${regVal} → ${moodVal}`);
    }
  }
  return lines;
}

const args = process.argv.slice(2);
const verb = args[0];

if (verb === 'list') {
  const files = readdirSync(MOODS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(MOODS_DIR, f), 'utf8'));
    const tokenCount = Object.keys(m.tokens || {}).length;
    console.log(`  ${m.id.padEnd(22)} ${tokenCount.toString().padStart(2)} token deltas — ${(m.doc || '').slice(0, 70)}`);
  }
}
else if (verb === 'preview' || verb === 'apply') {
  const moodName = args[1];
  if (!moodName) { console.error('usage: preview|apply <name>'); process.exit(1); }
  
  const reg = loadReg();
  const mood = loadMood(moodName);
  
  // Validate mood against registry
  const v = validateMood(mood, reg);
  if (!v.ok) {
    console.error(`✗ mood ${moodName} invalid:`);
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  
  console.log(`Mood: ${mood.name} (${mood.id})`);
  if (mood.doc) console.log(`  ${mood.doc}\n`);
  
  let totalChanges = 0;
  for (const [id, delta] of Object.entries(mood.tokens || {})) {
    const regTok = reg.tokens[id];
    if (!regTok) continue;
    const lines = diffCells(regTok.values, delta.values);
    if (lines.length > 0) {
      console.log(`--${id} (${regTok.kind}):`);
      for (const l of lines) console.log(l);
      totalChanges += lines.length;
    }
  }
  console.log(`\n${totalChanges} cell change(s).`);
  
  if (verb === 'apply') {
    // Write baseline backup if not present
    if (!existsSync(BASELINE_PATH)) {
      copyFileSync(REG_PATH, BASELINE_PATH);
      console.log(`  baseline saved: registry.baseline.json`);
    }
    
    // Apply: merge mood cells onto registry (cells not mentioned are left alone)
    for (const [id, delta] of Object.entries(mood.tokens || {})) {
      const regTok = reg.tokens[id];
      if (!regTok) continue;
      for (const [cellKey, moodVal] of Object.entries(delta.values)) {
        regTok.values[cellKey] = moodVal;
      }
    }
    
    writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + '\n');
    console.log(`✓ applied to registry. Regenerating CSS...`);
    execSync(`node ${CODEGEN} --registry ${REG_PATH} --out ${OUT_DIR} --quiet`, { stdio: 'inherit' });
    console.log(`✓ done. Run pnpm build to verify.`);
  }
}
else if (verb === 'reset') {
  if (!existsSync(BASELINE_PATH)) {
    console.error('✗ no baseline found. Have you ever applied a mood?');
    process.exit(1);
  }
  copyFileSync(BASELINE_PATH, REG_PATH);
  execSync(`node ${CODEGEN} --registry ${REG_PATH} --out ${OUT_DIR} --quiet`, { stdio: 'inherit' });
  console.log(`✓ reset to baseline. CSS regenerated.`);
}
else {
  console.error('verbs: list | preview <name> | apply <name> | reset');
  process.exit(1);
}
