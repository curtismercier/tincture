#!/usr/bin/env node
/**
 * tincture-migrate-components.mjs — cycle 3 (wave 1).
 *
 * Migrates Hero, Pricing, ReviewSpotlight from legacy --color-* tokens
 * to foundation tokens (--ink / --bg / --accent / etc.). Foundation
 * tokens are at :root with light-dark() pairs; migration is a pure
 * className string substitution.
 *
 * Pattern map:
 *   var(--color-text-primary)         → var(--ink)
 *   var(--color-text-secondary)       → var(--ink-soft)
 *   var(--color-text-muted)           → var(--ink-muted)
 *   var(--color-bg-primary)           → var(--bg)
 *   var(--color-bg-surface)           → var(--bg-card)
 *   var(--color-bg-elevated)          → var(--bg-elev)
 *   var(--color-accent-gold)          → var(--accent)
 *   var(--color-accent-warm)          → var(--accent-warm)
 *   var(--color-text-on-accent)       → var(--accent-fg)
 *   var(--color-text-on-gold)         → var(--accent-fg)
 *   var(--color-text-on-dark)         → var(--ink)
 *   var(--color-text-on-booth)        → var(--ink)
 *   var(--color-text-on-accent-band)  → var(--ink)
 *   var(--color-border-default)       → var(--border)
 *   var(--color-border-subtle)        → var(--border-soft)
 *
 * Per-theme blocks STAY for unmigrated components. Cycle 7 drops them.
 *
 * Idempotent. --dry / --check / apply.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { COMPONENTS_DIR, PAGES_DIR } from './_resolve-config.mjs';

const dry = process.argv.includes('--dry');
const checkMode = process.argv.includes('--check');

// Cycle 7: glob over ALL components + page files (was 3 targets in cycle 3)
function walk(dir, exts = ['.tsx', '.ts'], skip = ['node_modules', '.next', '.git', 'dist', '__tests__', '_generated', '_archive']) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const CWD = process.cwd();
const dirs = [COMPONENTS_DIR, PAGES_DIR].filter(Boolean);
const TARGETS = dirs.flatMap(walk).map((p) => p.slice(CWD.length + 1))
  .filter((p, i, arr) => arr.indexOf(p) === i); // dedupe

// Order matters: most-specific first so e.g. text-on-accent doesn't get
// caught by a generic text-on rule.
const RULES = [
  ['var(--color-text-on-accent-band)', 'var(--ink)'],
  ['var(--color-text-on-accent)',      'var(--accent-fg)'],
  ['var(--color-text-on-booth)',       'var(--ink)'],
  ['var(--color-text-on-dark)',        'var(--ink)'],
  ['var(--color-text-on-light)',       'var(--ink)'],
  ['var(--color-text-on-gold)',        'var(--accent-fg)'],
  ['var(--color-accent-gold)',         'var(--accent)'],
  ['var(--color-accent-warm)',         'var(--accent-warm)'],
  ['var(--color-accent-fg)',           'var(--accent-fg)'],
  ['var(--color-text-primary)',        'var(--ink)'],
  ['var(--color-text-secondary)',      'var(--ink-soft)'],
  ['var(--color-text-muted)',          'var(--ink-muted)'],
  ['var(--color-bg-primary)',          'var(--bg)'],
  ['var(--color-bg-surface)',          'var(--bg-card)'],
  ['var(--color-bg-elevated)',         'var(--bg-elev)'],
  ['var(--color-border-default)',      'var(--border)'],
  ['var(--color-border-subtle)',       'var(--border-soft)'],
];

const actions = [];

for (const rel of TARGETS) {
  const path = resolve(ROOT, rel);
  if (!existsSync(path)) {
    actions.push({ kind: 'missing', path: rel });
    continue;
  }
  const before = readFileSync(path, 'utf8');
  let after = before;
  let totalReplaced = 0;
  for (const [find, replace] of RULES) {
    const count = after.split(find).length - 1;
    if (count === 0) continue;
    after = after.split(find).join(replace);
    totalReplaced += count;
  }
  if (totalReplaced === 0) continue;
  if (!dry && !checkMode) writeFileSync(path, after, 'utf8');
  actions.push({ kind: 'migrate', path: rel, count: totalReplaced });
}

console.log('tincture-migrate-components — cycle 3');
console.log('');
if (actions.length === 0) {
  console.log('no actions — already up-to-date.');
} else {
  for (const a of actions) {
    if (a.kind === 'missing') console.log(`  ! MISSING ${a.path}`);
    else console.log(`  ${a.kind.padEnd(8)} ${a.path}  count=${a.count}`);
  }
}
console.log(`\nmode: ${dry ? 'dry-run' : checkMode ? 'check' : 'apply'}`);

if (checkMode) {
  const pending = actions.filter((a) => a.kind === 'migrate');
  if (pending.length > 0) {
    console.error(`\nx ${pending.length} pending.`);
    process.exit(1);
  }
  console.log('clean.');
  process.exit(0);
}
