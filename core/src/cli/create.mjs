#!/usr/bin/env node
/**
 * tincture create — scaffold Tincture into an existing project (cycle 17).
 *
 * Detects framework (Next.js, Vite, Astro), creates tincture/ folder,
 * inserts foundation.css + flavors.css imports, optionally registers
 * a ThemeProvider for surface×flavor.
 *
 * Usage:
 *   npx @tincture/core create
 *   npx @tincture/core create --target src/styles  --next
 *
 * Default target: src/tincture/
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '../..');
const args = process.argv.slice(2);

function flag(name, fb) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i < 0) return fb;
  return args[i + 1] ?? true;
}

const target = resolve(process.cwd(), flag('target', 'src/tincture'));
const isNext = args.includes('--next') || existsSync(resolve(process.cwd(), 'next.config.mjs'));

console.log(`tincture create → ${target}`);
if (existsSync(target)) {
  console.error(`x target ${target} already exists. Aborting (use --force to overwrite).`);
  if (!args.includes('--force')) process.exit(1);
}
mkdirSync(target, { recursive: true });
mkdirSync(join(target, 'foundation'), { recursive: true });
mkdirSync(join(target, 'moods'), { recursive: true });
mkdirSync(join(target, '_generated'), { recursive: true });

// Copy foundation files
const SRC = resolve(PKG_ROOT, 'src');
copyFileSync(join(SRC, 'foundation/foundation.css'), join(target, 'foundation/foundation.css'));
copyFileSync(join(SRC, 'foundation/flavors.css'), join(target, 'foundation/flavors.css'));

// Copy starter registry as registry.json
copyFileSync(join(SRC, 'registry.example.json'), join(target, 'registry.json'));

// Copy moods
import { readdirSync } from 'node:fs';
for (const f of readdirSync(join(SRC, 'moods'))) {
  copyFileSync(join(SRC, 'moods', f), join(target, 'moods', f));
}

// Copy generated
for (const f of readdirSync(join(SRC, '_generated'))) {
  copyFileSync(join(SRC, '_generated', f), join(target, '_generated', f));
}

console.log(`✓ scaffolded ${target}/`);
console.log('');
console.log('Next steps:');
console.log(`  1. Import the foundation in your app's globals.css:`);
console.log(`     @import "./tincture/foundation/foundation.css";`);
console.log(`     @import "./tincture/foundation/flavors.css";`);
console.log('');
console.log(`  2. Add data-surface and data-flavor attributes to <html>:`);
console.log(`     <html data-surface="light" data-flavor="cool">`);
console.log('');
console.log(`  3. Use tokens in your components:`);
console.log(`     <div className="bg-[var(--bg)] text-[var(--ink)]">`);
console.log('');
console.log(`  4. Customize: edit ${target}/registry.json, then`);
console.log(`     npx tincture codegen`);
