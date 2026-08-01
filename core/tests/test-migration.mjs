/**
 * Tincture v0.2 — migration tests (cycle 23).
 *
 * Verifies that v0.1 → v0.2 registry migration is:
 *   - Lossless for color tokens
 *   - Correctly infers kind from token id
 *   - Marks brand-mark-* as locked
 *   - Drops surface axis when light/dark values match
 *   - Resolves {primitives.x.y} placeholders
 *   - Produces a registry that passes validateRegistry()
 *
 * Plus mood migration tests.
 *
 * Run: node tests/test-migration.mjs
 */

import { migrateRegistry, migrateMood, inferKind } from '../src/cli/migrate-v01-to-v02.mjs';
import { validateRegistry, validateMood } from '../src/schema.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; process.stdout.write('.'); }
  else { failed++; failures.push({ name, detail }); process.stdout.write('F'); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function deepEq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
     `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── inferKind ────────────────────────────────────────────────────────
eq('inferKind: ink → color', inferKind('ink', '#000'), 'color');
eq('inferKind: bg → color', inferKind('bg', '#000'), 'color');
eq('inferKind: accent → color', inferKind('accent', '#000'), 'color');
eq('inferKind: brand-mark-primary → brand-lock', inferKind('brand-mark-primary', '#000'), 'brand-lock');
eq('inferKind: weight-display → typography', inferKind('weight-display', '700'), 'typography');
eq('inferKind: font-body → typography', inferKind('font-body', 'sans-serif'), 'typography');
eq('inferKind: type-display-1 → typography', inferKind('type-display-1', '4rem'), 'typography');
eq('inferKind: leading-tight → typography', inferKind('leading-tight', '1.1'), 'typography');
eq('inferKind: track-display → typography', inferKind('track-display', '-0.02em'), 'typography');
eq('inferKind: space-section → spacing', inferKind('space-section', '5rem'), 'spacing');
eq('inferKind: gap-rhythm → spacing', inferKind('gap-rhythm', '1rem'), 'spacing');
eq('inferKind: radius-soft → radius', inferKind('radius-soft', '12px'), 'radius');
eq('inferKind: shadow-lifted → shadow', inferKind('shadow-lifted', '0 4px 8px'), 'shadow');
eq('inferKind: motion-snap → motion', inferKind('motion-snap', '150ms'), 'motion');

// ── migrateRegistry: minimal v0.1 → v0.2 ─────────────────────────────
{
  const v01 = {
    version: '0.1.0',
    semantic: {
      ink: { type: 'color', doc: 'primary text', lightValue: '#1A1612', darkValue: '#FFFFFF' },
      'accent-fg': { type: 'color', lightValue: '#FFFFFF', darkValue: '#FFFFFF' }, // surface-invariant
      'brand-mark-primary': { type: 'color', lightValue: '#EF4123', darkValue: '#EF4123' },
    }
  };
  const v02 = migrateRegistry(v01);
  
  ok('version bumped 0.1.0 → 0.2.0', v02.version === '0.2.0');
  ok('ink token exists', v02.tokens.ink !== undefined);
  eq('ink kind = color', v02.tokens.ink.kind, 'color');
  deepEq('ink axes = [surface] (light != dark)', v02.tokens.ink.axes, ['surface']);
  eq('ink default value', v02.tokens.ink.values.default, '#1A1612');
  eq('ink surface=dark value', v02.tokens.ink.values['surface=dark'], '#FFFFFF');
  eq('ink doc preserved', v02.tokens.ink.doc, 'primary text');

  // accent-fg has identical light/dark → no surface axis, no surface=dark cell
  deepEq('accent-fg axes = [] (light == dark)', v02.tokens['accent-fg'].axes, []);
  eq('accent-fg has only default cell', Object.keys(v02.tokens['accent-fg'].values).join(','), 'default');

  // brand-mark-primary is locked + axes []
  eq('brand-mark-primary kind = brand-lock', v02.tokens['brand-mark-primary'].kind, 'brand-lock');
  ok('brand-mark-primary locked', v02.tokens['brand-mark-primary'].locked === true);
  deepEq('brand-mark-primary axes = []', v02.tokens['brand-mark-primary'].axes, []);

  // Migrated registry passes validation
  const validation = validateRegistry(v02);
  ok('migrated registry validates', validation.ok, JSON.stringify(validation.errors));
}

// ── migrateRegistry: with primitives placeholder ─────────────────────
{
  const v01 = {
    version: '0.1.1',
    primitives: {
      color: {
        'ink-dark': { value: '#1A1612' },
        'ink-light': { value: '#FFFFFF' },
      }
    },
    semantic: {
      ink: {
        lightValue: '{primitives.color.ink-dark}',
        darkValue: '{primitives.color.ink-light}',
      }
    }
  };
  const v02 = migrateRegistry(v01);
  eq('placeholder resolved (light)', v02.tokens.ink.values.default, '#1A1612');
  eq('placeholder resolved (dark)', v02.tokens.ink.values['surface=dark'], '#FFFFFF');
  ok('primitives preserved', v02.primitives !== undefined);
  ok('migrated with primitives validates', validateRegistry(v02).ok);
}

// ── migrateMood: lightValue + darkValue → axis-cells ─────────────────
{
  const v02Reg = {
    version: '0.2.0',
    tokens: {
      ink: { kind: 'color', axes: ['surface'], values: { default: '#000', 'surface=dark': '#fff' } },
      accent: { kind: 'color', axes: ['surface'], values: { default: '#C00', 'surface=dark': '#E00' } },
    }
  };
  const v01Mood = {
    id: 'aggressive',
    name: 'Aggressive',
    tokens: {
      ink: { lightValue: '#000', darkValue: '#FFF' },
      accent: { lightValue: '#FF0000' },
    }
  };
  const v02Mood = migrateMood(v01Mood, v02Reg);
  eq('mood id preserved', v02Mood.id, 'aggressive');
  eq('mood ink default', v02Mood.tokens.ink.values.default, '#000');
  eq('mood ink dark', v02Mood.tokens.ink.values['surface=dark'], '#FFF');
  // accent had no darkValue → no surface=dark cell
  ok('mood accent has only default', !('surface=dark' in v02Mood.tokens.accent.values));
  
  ok('migrated mood validates against registry', validateMood(v02Mood, v02Reg).ok);
}

// ── migrateMood: skip surface=dark when registry doesn't declare surface axis ─
{
  const v02Reg = {
    version: '0.2.0',
    tokens: {
      'accent-fg': { kind: 'color', axes: [], values: { default: '#FFF' } },
    }
  };
  const v01Mood = {
    id: 'x', name: 'X',
    tokens: {
      'accent-fg': { lightValue: '#FFF', darkValue: '#000' }, // both, but registry doesn't have surface axis
    }
  };
  const v02Mood = migrateMood(v01Mood, v02Reg);
  ok('mood skips surface=dark when registry token has no surface axis',
     !('surface=dark' in v02Mood.tokens['accent-fg'].values));
}

// ── summary ─────────────────────────────────────────────────────────
console.log(`\n\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log('All migration tests passed.');
process.exit(0);
