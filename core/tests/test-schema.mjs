/**
 * Tincture v0.2 — schema validator tests.
 *
 * Runs both POSITIVE (valid registry should pass) and NEGATIVE
 * (each invalid case should produce a specific error) tests.
 *
 * Run: node tests/test-schema.mjs
 * Exit 0 = all tests passed; exit 1 = at least one failed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  validateRegistry,
  validateMood,
  parseAxisCellKey,
  serialiseAxisCellKey,
  AXES,
  AXIS_VALUES,
  TOKEN_KINDS,
} from '../src/schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    process.stdout.write('.');
  } else {
    failed++;
    failures.push({ name, detail });
    process.stdout.write('F');
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function deepEq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function errIncludes(name, errors, substring) {
  const match = errors.some(e => e.includes(substring));
  ok(name, match, `expected an error including "${substring}", got ${JSON.stringify(errors)}`);
}

// ── parseAxisCellKey ─────────────────────────────────────────────────

deepEq('parse default', parseAxisCellKey('default'), {});
deepEq('parse single axis', parseAxisCellKey('surface=dark'), { surface: 'dark' });
deepEq('parse compound alphabetised', parseAxisCellKey('flavor=warm,surface=dark'), { flavor: 'warm', surface: 'dark' });
eq('parse non-alphabetised → null', parseAxisCellKey('surface=dark,flavor=warm'), null);
eq('parse duplicate axis → null', parseAxisCellKey('surface=dark,surface=light'), null);
eq('parse unknown axis → null', parseAxisCellKey('vibe=spooky'), null);
eq('parse unknown value → null', parseAxisCellKey('surface=neon'), null);
eq('parse malformed → null', parseAxisCellKey('surface'), null);
eq('parse empty → null', parseAxisCellKey(''), null);

// ── serialiseAxisCellKey ─────────────────────────────────────────────

eq('serialise empty → default', serialiseAxisCellKey({}), 'default');
eq('serialise single', serialiseAxisCellKey({ surface: 'dark' }), 'surface=dark');
eq('serialise compound (alphabetises)', serialiseAxisCellKey({ surface: 'dark', flavor: 'warm' }), 'flavor=warm,surface=dark');
eq('serialise round-trips', serialiseAxisCellKey(parseAxisCellKey('flavor=warm,surface=dark')), 'flavor=warm,surface=dark');

// ── validateRegistry — positive case ─────────────────────────────────

const goodRegistry = JSON.parse(readFileSync(resolve(ROOT, 'src/registry.v02-example.json'), 'utf8'));
const goodResult = validateRegistry(goodRegistry);
ok('example registry validates clean', goodResult.ok, `errors: ${JSON.stringify(goodResult.errors)}`);
eq('example registry has no errors', goodResult.errors.length, 0);

// ── validateRegistry — negative cases ────────────────────────────────

function makeReg(tokens) {
  return { version: '0.2.0', tokens };
}

// Missing version
{
  const r = validateRegistry({ tokens: {} });
  ok('rejects missing version', !r.ok);
  errIncludes('missing version error message', r.errors, 'version');
}

// Token with unknown kind
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'glitter', axes: [], values: { default: '#FFF' } }
  }));
  ok('rejects unknown kind', !r.ok);
  errIncludes('unknown kind error', r.errors, 'kind');
}

// Token with unknown axis
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'color', axes: ['surface', 'mood'], values: { default: '#FFF' } }
  }));
  ok('rejects unknown axis', !r.ok);
  errIncludes('unknown axis error', r.errors, 'unknown axis');
}

// Cell uses axis not declared
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'color', axes: ['surface'], values: { default: '#FFF', 'flavor=warm': '#EEE' } }
  }));
  ok('rejects cell using undeclared axis', !r.ok);
  errIncludes('cell-axis mismatch error', r.errors, 'not declared');
}

// Missing default cell
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'color', axes: ['surface'], values: { 'surface=dark': '#FFF' } }
  }));
  ok('rejects missing default cell', !r.ok);
  errIncludes('missing default error', r.errors, "'default' cell");
}

// Locked token with axes
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'brand-lock', axes: ['surface'], locked: true, values: { default: '#FFF' } }
  }));
  ok('rejects locked token with axes', !r.ok);
  errIncludes('locked-with-axes error', r.errors, 'locked');
}

// Locked token with non-default cells
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'brand-lock', axes: [], locked: true, values: { default: '#FFF', 'surface=dark': '#000' } }
  }));
  ok('rejects locked token with extra cells', !r.ok);
}

// Malformed cell key
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'color', axes: ['surface'], values: { default: '#FFF', 'surface=neon': '#0F0' } }
  }));
  ok('rejects unknown cell value', !r.ok);
  errIncludes('malformed-key error', r.errors, 'malformed');
}

// Empty value string
{
  const r = validateRegistry(makeReg({
    bad: { kind: 'color', axes: [], values: { default: '' } }
  }));
  ok('rejects empty value', !r.ok);
  errIncludes('empty-value error', r.errors, 'non-empty string');
}

// ── validateMood ────────────────────────────────────────────────────

const goodMood = {
  id: 'performance',
  name: 'Performance',
  tokens: {
    accent: { values: { default: '#E62719', 'surface=dark': '#FF3A1A' } },
    'weight-display': { values: { 'surface=dark': '900' } },
  },
};
{
  const r = validateMood(goodMood, goodRegistry);
  ok('valid mood passes', r.ok, `errors: ${JSON.stringify(r.errors)}`);
}

// Mood targets unknown token
{
  const r = validateMood({
    id: 'x', name: 'x',
    tokens: { 'unknown-token': { values: { default: 'foo' } } }
  }, goodRegistry);
  ok('rejects mood touching unknown token', !r.ok);
  errIncludes('unknown-token-in-mood error', r.errors, 'does not exist');
}

// Mood targets locked brand primitive
{
  const r = validateMood({
    id: 'x', name: 'x',
    tokens: { 'brand-mark-primary': { values: { default: '#000' } } }
  }, goodRegistry);
  ok('rejects mood touching locked brand-lock token', !r.ok);
  errIncludes('locked-token-in-mood error', r.errors, 'locked');
}

// Mood uses axis the registry token doesn't declare
{
  const r = validateMood({
    id: 'x', name: 'x',
    tokens: { 'ink-soft': { values: { 'flavor=warm': '#000' } } }  // ink-soft only declares ['surface']
  }, goodRegistry);
  ok('rejects mood using undeclared axis', !r.ok);
  errIncludes('mood-axis-mismatch error', r.errors, 'not declared');
}

// ── summary ─────────────────────────────────────────────────────────

console.log(`\n\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(1);
}
console.log('All tests passed.');
process.exit(0);
