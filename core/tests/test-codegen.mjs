/**
 * Tincture v0.2 — codegen tests.
 *
 * 1. Idempotency — running codegen twice produces byte-identical output
 * 2. Foundation.css contains expected cascade rules + uses NO light-dark()
 * 3. Manifest.json shape is correct (each token has cells[] sorted)
 * 4. Tokens.d.ts emits a valid TS union
 * 5. Specificity ordering — compound selectors come AFTER single-axis
 *
 * Run: node tests/test-codegen.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'tests/.codegen-tmp');
const REGISTRY = resolve(ROOT, 'src/registry.v02-example.json');
const CODEGEN = resolve(ROOT, 'src/cli/codegen-v2.mjs');

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

// ── setup: clean output dir ─────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ── run codegen twice (idempotency) ──────────────────────────────────
function runCodegen() {
  return execSync(`node ${CODEGEN} --registry ${REGISTRY} --out ${OUT} --quiet`, {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

runCodegen();
const foundation1 = readFileSync(resolve(OUT, 'foundation.css'), 'utf8');
const manifest1 = readFileSync(resolve(OUT, 'manifest.json'), 'utf8');
const tokens1 = readFileSync(resolve(OUT, 'tokens.d.ts'), 'utf8');

runCodegen();
const foundation2 = readFileSync(resolve(OUT, 'foundation.css'), 'utf8');
const manifest2 = readFileSync(resolve(OUT, 'manifest.json'), 'utf8');
const tokens2 = readFileSync(resolve(OUT, 'tokens.d.ts'), 'utf8');

ok('foundation.css idempotent', foundation1 === foundation2,
   `lengths: ${foundation1.length} vs ${foundation2.length}`);
ok('manifest.json idempotent', manifest1 === manifest2);
ok('tokens.d.ts idempotent', tokens1 === tokens2);

// ── foundation.css content checks ────────────────────────────────────
ok('foundation has :root rule', foundation1.includes(':root {'));
ok('foundation has color-scheme: light at root', foundation1.match(/:root \{[^}]*color-scheme: light/));
ok('foundation has [data-surface="dark"] override',
   foundation1.includes('[data-surface="dark"] {'));
ok('foundation has color-scheme: dark on dark surface',
   foundation1.match(/\[data-surface="dark"\] \{[^}]*color-scheme: dark/));
ok('foundation has compound selector for surface+flavor',
   foundation1.includes('[data-flavor="warm"][data-surface="dark"] {') ||
   foundation1.includes('[data-surface="dark"][data-flavor="warm"] {'));

ok('foundation contains --ink declaration', foundation1.includes('--ink:'));
ok('foundation contains --bg declaration', foundation1.includes('--bg:'));
ok('foundation contains --weight-display', foundation1.includes('--weight-display:'));
ok('foundation contains --space-section', foundation1.includes('--space-section:'));
ok('foundation contains --shadow-lifted', foundation1.includes('--shadow-lifted:'));
ok('foundation contains --brand-mark-primary', foundation1.includes('--brand-mark-primary:'));
ok('foundation contains version sentinel',
   foundation1.includes('--tincture-foundation-version: "0.2.2"'));

// CRITICAL: NO light-dark() in v0.2 codegen output
ok('foundation has ZERO light-dark() calls', !foundation1.includes('light-dark('),
   `unexpected light-dark() in: ${foundation1.match(/light-dark\([^)]*\)/g)}`);

// ── specificity ordering: default first, then 1-axis, then 2-axis ────
function findRuleStart(css, selector) {
  return css.indexOf(`${selector} {`);
}

const idxRoot = findRuleStart(foundation1, ':root');
const idxSurfaceDark = findRuleStart(foundation1, '[data-surface="dark"]');
const idxToneFeature = findRuleStart(foundation1, '[data-tone="feature"]');
const idxCompound1 = findRuleStart(foundation1, '[data-flavor="warm"][data-surface="dark"]');
const idxCompound2 = findRuleStart(foundation1, '[data-elevation="dramatic"][data-surface="dark"]');

ok(':root rule appears first', idxRoot >= 0 && idxRoot < idxSurfaceDark);
ok('1-axis rules appear before 2-axis (surface-dark < flavor=warm,surface=dark)',
   idxSurfaceDark < idxCompound1);
ok('1-axis rules appear before 2-axis (tone-feature < elevation=dramatic,surface=dark)',
   idxToneFeature >= 0 && idxToneFeature < idxCompound2);

// ── manifest.json shape ──────────────────────────────────────────────
const manifest = JSON.parse(manifest1);
ok('manifest has schemaVersion 2.0', manifest.schemaVersion === '2.0');
ok('manifest registry version matches', manifest.registry.version === '0.2.2');
ok('manifest tokens.ink exists', manifest.tokens.ink !== undefined);
ok('manifest tokens.ink has axes', JSON.stringify(manifest.tokens.ink.axes) === JSON.stringify(['surface', 'flavor']));
ok('manifest tokens.ink has defaultValue', manifest.tokens.ink.defaultValue === '#1A1612');
ok('manifest tokens.ink.cells has multiple entries', manifest.tokens.ink.cells.length >= 4);
ok('manifest tokens.ink.cells default first',
   manifest.tokens.ink.cells[0].cell === 'default');
ok('manifest tokens.brand-mark-primary locked',
   manifest.tokens['brand-mark-primary'].locked === true);
ok('manifest tokens.brand-mark-primary has empty axes',
   JSON.stringify(manifest.tokens['brand-mark-primary'].axes) === '[]');

// ── tokens.d.ts shape ────────────────────────────────────────────────
ok('tokens.d.ts has TokenId export', tokens1.includes('export type TokenId'));
ok('tokens.d.ts includes "ink"', tokens1.includes('"ink"'));
ok('tokens.d.ts includes "brand-mark-primary"', tokens1.includes('"brand-mark-primary"'));
ok('tokens.d.ts has TOKEN_IDS const', tokens1.includes('export const TOKEN_IDS'));
ok('tokens.d.ts uses as const', tokens1.includes('as const'));

// ── invalid registry should fail codegen ─────────────────────────────
{
  const badPath = resolve(OUT, 'bad-registry.json');
  writeFileSync(badPath, JSON.stringify({
    version: '0.2.0',
    tokens: { bad: { kind: 'glitter', axes: [], values: { default: '#FFF' } } }
  }));
  let exitCode = 0;
  try {
    execSync(`node ${CODEGEN} --registry ${badPath} --out ${OUT}/bad --quiet`,
      { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status;
  }
  ok('codegen exits non-zero on invalid registry', exitCode !== 0,
     `got exit code ${exitCode}`);
}

// ── cleanup ─────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true });

// ── summary ─────────────────────────────────────────────────────────
console.log(`\n\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.detail || '(no detail)'}`);
  }
  process.exit(1);
}
console.log('All codegen tests passed.');
process.exit(0);
