#!/usr/bin/env node
/**
 * tincture-verify.mjs — cycle 11.
 *
 * Static-analysis: walks every component file, extracts var(--*)
 * references, cross-checks against registry's component manifest.
 *
 * Reports:
 *   - "undeclared":   token used in source but not in component's tokens-read
 *   - "stale":        token declared in registry but not actually used in source
 *   - "alias-only":   source references a legacy --color-* alias that maps to a
 *                     foundation token — count as "reads X"
 *
 * Exit 0 if clean. Exit 1 with diagnostic.
 *
 * Usage:
 *   tincture verify                 — diff report
 *   tincture verify --update        — rewrite registry tokens-read to match reality
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd(); // consumer project root — component files resolve from here
import { REGISTRY_PATH as REGISTRY } from './_resolve-config.mjs';

const update = process.argv.includes('--update');
const jsonOut = process.argv.includes('--json');

const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));

// Build legacy-alias → foundation-id map
const legacyMap = {};
for (const [id, tok] of Object.entries(reg.semantic ?? {})) {
  for (const legacy of tok.legacy ?? []) legacyMap[legacy] = id;
}

// All foundation token ids
const foundationIds = new Set(Object.keys(reg.semantic ?? {}));

// Walk source for var(--*) refs in component files
function findRefs(content) {
  const re = /var\(--([a-z][a-z0-9-]*)\)/g;
  const found = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = `--${m[1]}`;
    // Map legacy → foundation
    const id = foundationIds.has(m[1]) ? m[1] : legacyMap[name];
    if (id) found.add(id);
  }
  return [...found];
}

const reports = [];
for (const [name, comp] of Object.entries(reg.components ?? {})) {
  const path = resolve(ROOT, comp.file);
  if (!existsSync(path)) {
    reports.push({ component: name, error: 'file missing', file: comp.file });
    continue;
  }
  const content = readFileSync(path, 'utf8');
  const actual = new Set(findRefs(content));
  const declared = new Set(comp['tokens-read'] ?? []);
  const undeclared = [...actual].filter((x) => !declared.has(x));
  const stale = [...declared].filter((x) => !actual.has(x));
  const ok = undeclared.length === 0 && stale.length === 0;
  reports.push({
    component: name,
    file: comp.file,
    ok,
    actualCount: actual.size,
    declaredCount: declared.size,
    undeclared,
    stale,
  });
}

if (jsonOut) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  console.log('tincture-verify — cycle 11');
  console.log('');
  for (const r of reports) {
    if (r.error) {
      console.log(`  ✗ ${r.component} — ${r.error}`);
      continue;
    }
    const mark = r.ok ? '✓' : '~';
    console.log(`  ${mark} ${r.component.padEnd(20)} actual=${r.actualCount} declared=${r.declaredCount}`);
    if (r.undeclared.length) {
      console.log(`     undeclared (in code, not in registry): ${r.undeclared.map((x) => `--${x}`).join(', ')}`);
    }
    if (r.stale.length) {
      console.log(`     stale (in registry, not in code): ${r.stale.map((x) => `--${x}`).join(', ')}`);
    }
  }
  const fails = reports.filter((r) => !r.ok && !r.error).length;
  console.log('');
  console.log(`  ${reports.length - fails}/${reports.length} clean.`);
}

if (update) {
  for (const r of reports) {
    if (r.error || r.ok) continue;
    reg.components[r.component]['tokens-read'] = [...new Set([...(reg.components[r.component]['tokens-read'] ?? []), ...r.undeclared])].sort();
    // Don't auto-remove "stale" — those might be expected for components that conditionally render
  }
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  console.log('\n✓ registry updated. Run `pnpm tincture:codegen` to regenerate manifest.');
}

const totalIssues = reports.filter((r) => !r.ok && !r.error).length;
if (totalIssues > 0 && !update) process.exit(1);
