/**
 * Tincture — runtime mood tests.
 *
 * 1. normalizeMood accepts v0.1 (lightValue/darkValue) and v0.2 (values cells)
 * 2. moodVars picks the most specific matching cell; unmatched cells fall back to default
 * 3. moodCss emits default + per-cell blocks in codegen order, wrapper AND descendant forms
 * 4. applyMood/clearMood round-trip on a fake element
 * 5. An empty mood is a no-op (the `neutral` contract)
 * 6. Codegen: `runtime-moods` off → no `--mood-` in output; on → every unlocked token wrapped,
 *    locked tokens raw; CLI flag overrides the registry field both ways
 *
 * Run: node tests/test-runtime-mood.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeMood, moodVars, moodCss, applyMood, clearMood } from '../src/runtime/mood.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'tests/.runtime-mood-tmp');
const REGISTRY = resolve(ROOT, 'src/registry.v02-example.json');

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; process.stdout.write('.'); }
  else { failed++; failures.push({ name, detail }); process.stdout.write('F'); }
}

// ── 1. normalise both shapes ─────────────────────────────────────────
const v01 = { id: 'v01', tokens: { accent: { lightValue: '#111', darkValue: '#eee' } } };
const v02 = { id: 'v02', tokens: {
  accent: { values: { default: '#111', 'surface=dark': '#eee', 'flavor=warm,surface=dark': '#fa0' } },
  ink:    { values: { 'surface=dark': '#fff' } },
} };
ok('v0.1 lightValue → default', normalizeMood(v01).tokens.accent.default === '#111');
ok('v0.1 darkValue → surface=dark', normalizeMood(v01).tokens.accent['surface=dark'] === '#eee');
ok('v0.2 cells pass through', normalizeMood(v02).tokens.accent['flavor=warm,surface=dark'] === '#fa0');
ok('empty delta is dropped', Object.keys(normalizeMood({ id: 'x', tokens: { accent: {} } }).tokens).length === 0);

// ── 2. moodVars resolution ───────────────────────────────────────────
ok('no axes → default cell', moodVars(v02).accent === undefined && moodVars(v02)['--mood-accent'] === '#111');
ok('surface=dark → dark cell', moodVars(v02, { surface: 'dark' })['--mood-accent'] === '#eee');
ok('2-axis cell beats 1-axis', moodVars(v02, { surface: 'dark', flavor: 'warm' })['--mood-accent'] === '#fa0');
ok('extra axis does not disqualify a 1-axis cell', moodVars(v02, { surface: 'dark', flavor: 'cool' })['--mood-accent'] === '#eee');
ok('token with only a dark cell is absent on light', moodVars(v02, { surface: 'light' })['--mood-ink'] === undefined);
ok('token with only a dark cell present on dark', moodVars(v02, { surface: 'dark' })['--mood-ink'] === '#fff');

// ── 3. moodCss ───────────────────────────────────────────────────────
const css = moodCss(v02);
ok('css default block under [data-mood]', css.includes('[data-mood="v02"] {\n  --mood-accent: #111;'));
ok('css dark block on wrapper AND descendant',
   css.includes('[data-mood="v02"][data-surface="dark"], [data-mood="v02"] [data-surface="dark"] {'));
ok('css 2-axis block after 1-axis',
   css.indexOf('[data-surface="dark"] {') < css.indexOf('[data-flavor="warm"][data-surface="dark"]'));
ok('css custom selector', moodCss(v01, { selector: 'html' }).startsWith('/* tincture mood: v01 */\nhtml {'));
ok('css axis attribute alias', moodCss(v01, { attributes: { surface: 'data-theme' } }).includes('[data-mood="v01"][data-theme="dark"], [data-mood="v01"] [data-theme="dark"] {'));
ok('css dark block carries ink', /\[data-surface="dark"\] \{\n(  --mood-[a-z-]+: [^;]+;\n)*  --mood-ink: #fff;/.test(css));

// ── 4. applyMood / clearMood on a fake element ───────────────────────
function fakeEl() {
  const props = new Map(); const attrs = new Map();
  return {
    props, attrs,
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k),
    removeAttribute: (k) => attrs.delete(k),
  };
}
const el = fakeEl();
const applied = applyMood(el, v02, { surface: 'dark' });
ok('applyMood sets vars', el.props.get('--mood-accent') === '#eee' && el.props.get('--mood-ink') === '#fff');
ok('applyMood returns what it set', applied['--mood-accent'] === '#eee');
ok('applyMood sets data-mood', el.attrs.get('data-mood') === 'v02');
applyMood(el, v02, { surface: 'light' });
ok('re-apply on light drops the dark-only var', !el.props.has('--mood-ink') && el.props.get('--mood-accent') === '#111');
clearMood(el, v02);
ok('clearMood removes vars + attribute', el.props.size === 0 && !el.attrs.has('data-mood'));
let threw = false; try { applyMood(null, v02); } catch { threw = true; }
ok('applyMood throws on non-element', threw);

// ── 5. neutral contract ──────────────────────────────────────────────
ok('empty mood → no vars', Object.keys(moodVars({ id: 'neutral' })).length === 0);
ok('empty mood → header-only css', moodCss({ id: 'neutral' }) === '/* tincture mood: neutral */\n');

// ── 6. codegen indirection ───────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const regOn = resolve(OUT, 'registry-on.json');
writeFileSync(regOn, JSON.stringify({ ...reg, 'runtime-moods': true }, null, 2));
const lockedIds = Object.entries(reg.tokens).filter(([, t]) => t.locked).map(([id]) => id);
const unlockedIds = Object.entries(reg.tokens).filter(([, t]) => !t.locked).map(([id]) => id);
ok('fixture has ≥1 locked and ≥1 unlocked token', lockedIds.length >= 1 && unlockedIds.length >= 1);

function gen(name, registry, extra = '') {
  const out = resolve(OUT, name);
  for (const cli of ['codegen.mjs', 'codegen-v2.mjs']) {
    execSync(`node ${resolve(ROOT, 'src/cli', cli)} --registry ${registry} --out ${out}-${cli} --quiet ${extra}`, { cwd: ROOT });
  }
  const a = readFileSync(`${out}-codegen.mjs/foundation.css`, 'utf8');
  const b = readFileSync(`${out}-codegen-v2.mjs/foundation.css`, 'utf8');
  ok(`${name}: both CLIs agree (modulo generator header)`, a.replace(/codegen\.mjs/g, 'X') === b.replace(/codegen-v2\.mjs/g, 'X'));
  return { css: a, manifest: JSON.parse(readFileSync(`${out}-codegen.mjs/manifest.json`, 'utf8')) };
}

const off = gen('off', REGISTRY);
ok('off: no --mood- anywhere', !off.css.includes('--mood-'));
ok('off: manifest carries no runtimeMoods key', !('runtimeMoods' in off.manifest.registry));

const on = gen('on', regOn);
const declRe = (id) => new RegExp(`^  --${id}: (.*);$`, 'm');
ok('on: every unlocked token wrapped', unlockedIds.every(id => {
  const m = on.css.match(declRe(id)); return m && m[1].startsWith(`var(--mood-${id}, `);
}), unlockedIds.filter(id => !(on.css.match(declRe(id))?.[1] || '').startsWith(`var(--mood-${id}, `)).join(','));
ok('on: every locked token raw', lockedIds.every(id => {
  const m = on.css.match(declRe(id)); return m && !m[1].includes('--mood-');
}));
ok('on: wrapped in non-default cells too', /\[data-surface="dark"\] \{[^}]*--ink: var\(--mood-ink, /.test(on.css));
ok('on: manifest runtimeMoods true', on.manifest.registry.runtimeMoods === true);
ok('on: fallback value equals the off value (ink)', (() => {
  const offV = off.css.match(declRe('ink'))[1];
  const onV = on.css.match(declRe('ink'))[1];
  return onV === `var(--mood-ink, ${offV})`;
})());

const forcedOn = gen('forced-on', REGISTRY, '--runtime-moods');
ok('--runtime-moods flag turns it on', forcedOn.css.includes('var(--mood-ink, '));
const forcedOff = gen('forced-off', regOn, '--no-runtime-moods');
ok('--no-runtime-moods flag turns it off', !forcedOff.css.includes('--mood-'));

// idempotent with the flag on
const on2 = gen('on2', regOn);
ok('on: idempotent', on.css === on2.css);

// axis-attributes alias: the surface axis keyed on data-theme
const regAlias = resolve(OUT, 'registry-alias.json');
writeFileSync(regAlias, JSON.stringify({ ...reg, 'axis-attributes': { surface: 'data-theme' } }, null, 2));
const alias = gen('alias', regAlias);
ok('alias: surface cells keyed on data-theme', alias.css.includes('[data-theme="dark"] {') && !alias.css.includes('[data-surface="dark"]'));
ok('alias: other axes untouched', alias.css.includes('[data-tone="feature"] {'));
ok('alias: compound cell uses the alias', alias.css.includes('[data-flavor="warm"][data-theme="dark"] {'));
ok('alias: manifest records it', alias.manifest.registry.axisAttributes?.surface === 'data-theme' && alias.manifest.tokens.ink.cells.some(c => c.selector === '[data-theme="dark"]'));
ok('no alias: manifest carries no axisAttributes key', !('axisAttributes' in off.manifest.registry));

// default-surface: the :root cell's color-scheme follows it
const regDark = resolve(OUT, 'registry-dark.json');
writeFileSync(regDark, JSON.stringify({ ...reg, 'default-surface': 'dark' }, null, 2));
const dark = gen('dark-default', regDark);
ok('default-surface=dark: :root color-scheme dark', /:root \{\n  color-scheme: dark;/.test(dark.css));
ok('default-surface=dark: surface=light cell still light', /\[data-surface="light"\] \{\n  color-scheme: light;/.test(dark.css));
ok('default-surface unset: :root color-scheme light', /:root \{\n  color-scheme: light;/.test(off.css));
ok('default-surface=dark: manifest records it', dark.manifest.registry.defaultSurface === 'dark');
const regBad = resolve(OUT, 'registry-bad.json');
writeFileSync(regBad, JSON.stringify({ ...reg, 'default-surface': 'steel' }, null, 2));
let badThrew = false; try { execSync(`node ${resolve(ROOT, 'src/cli/codegen.mjs')} --registry ${regBad} --out ${resolve(OUT, 'bad')} --quiet`, { cwd: ROOT, stdio: 'pipe' }); } catch { badThrew = true; }
ok('default-surface invalid: codegen refuses', badThrew);

rmSync(OUT, { recursive: true });

console.log(`\n\n${passed} passed, ${failed} failed.`);
if (failed) {
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('All runtime-mood tests passed.');
