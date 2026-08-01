#!/usr/bin/env node
/**
 * tincture-mood.mjs — cycles 12-15.
 *
 * Apply a mood preset: read mood JSON, compose deltas onto registry,
 * regen _generated/. Save current as a new mood. Diff between moods.
 *
 * Usage:
 *   tincture-mood apply <name>          — apply mood to registry + regen
 *   tincture-mood diff <a> <b>          — show token-level diff between two moods
 *   tincture-mood save <name> <doc>     — save current registry-deltas as new mood
 *   tincture-mood preview <name>        — print what would change without applying
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { REGISTRY_PATH as REG, MOODS_DIR } from './_resolve-config.mjs';

const args = process.argv.slice(2);
const verb = args[0];

function loadMood(name) {
  const p = join(MOODS_DIR, `${name}.json`);
  if (!existsSync(p)) {
    console.error(`x mood "${name}" not found at ${p}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadRegistry() { return JSON.parse(readFileSync(REG, 'utf8')); }
function saveRegistry(r) { writeFileSync(REG, JSON.stringify(r, null, 2) + '\n', 'utf8'); }

function applyMood(mood, reg) {
  for (const [tokenId, delta] of Object.entries(mood.tokens ?? {})) {
    if (!reg.semantic[tokenId]) {
      console.error(`! mood references unknown token "${tokenId}" — skipping`);
      continue;
    }
    if (delta.lightValue !== undefined) reg.semantic[tokenId].lightValue = delta.lightValue;
    if (delta.darkValue !== undefined) reg.semantic[tokenId].darkValue = delta.darkValue;
  }
}

if (verb === 'apply') {
  const name = args[1];
  if (!name) { console.error('usage: tincture-mood apply <name>'); process.exit(2); }
  const mood = loadMood(name);
  const reg = loadRegistry();
  applyMood(mood, reg);
  saveRegistry(reg);
  console.log(`✓ applied mood "${name}".`);
  console.log(`  ${Object.keys(mood.tokens ?? {}).length} token(s) overridden.`);
  console.log(`  regenerating _generated/...`);
  execSync(`node ${join(__dirname, 'tincture-codegen.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
} else if (verb === 'preview') {
  const name = args[1];
  const mood = loadMood(name);
  const reg = loadRegistry();
  console.log(`mood "${name}" — ${Object.keys(mood.tokens ?? {}).length} change(s):`);
  for (const [id, delta] of Object.entries(mood.tokens ?? {})) {
    const cur = reg.semantic[id];
    if (!cur) { console.log(`  ! ${id} — unknown token`); continue; }
    if (delta.lightValue && cur.lightValue !== delta.lightValue) {
      console.log(`  --${id} light: ${cur.lightValue} → ${delta.lightValue}`);
    }
    if (delta.darkValue && cur.darkValue !== delta.darkValue) {
      console.log(`  --${id} dark:  ${cur.darkValue} → ${delta.darkValue}`);
    }
  }
} else if (verb === 'diff') {
  const a = loadMood(args[1]);
  const b = loadMood(args[2]);
  const allKeys = new Set([...Object.keys(a.tokens ?? {}), ...Object.keys(b.tokens ?? {})]);
  console.log(`diff: ${a.id} → ${b.id}`);
  for (const k of allKeys) {
    const av = a.tokens?.[k] ?? {};
    const bv = b.tokens?.[k] ?? {};
    if (av.lightValue !== bv.lightValue) console.log(`  --${k} light: ${av.lightValue ?? '(unset)'} → ${bv.lightValue ?? '(unset)'}`);
    if (av.darkValue !== bv.darkValue)   console.log(`  --${k} dark:  ${av.darkValue ?? '(unset)'} → ${bv.darkValue ?? '(unset)'}`);
  }
} else if (verb === 'list') {
  const files = readdirSync(MOODS_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(MOODS_DIR, f), 'utf8'));
    console.log(`  ${m.id.padEnd(20)} ${m.doc?.slice(0, 80) ?? ''}`);
  }
} else {
  console.log('verbs: apply | preview | diff | list');
}
