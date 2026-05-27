#!/usr/bin/env node
/**
 * tincture.mjs — CLI for the Tincture design token system.
 *
 * Structured ops over the registry + manifest. Designed for agents
 * and humans: predictable verbs, composable stages, consistent output.
 *
 * Usage:
 *   tincture                                 — overview + command list
 *   tincture status                          — project summary (tokens, surfaces, moods)
 *   tincture tokens list                     — all semantic tokens
 *   tincture tokens get <id>                 — single token detail
 *   tincture tokens find --role <r>          — query by role
 *   tincture tokens find --legacy <name>     — find which token absorbs a legacy alias
 *   tincture tokens impact <id>              — components + pages affected by changing this
 *   tincture tokens set <id> --light <hex> --dark <hex> — write to registry, regen
 *   tincture init                            — scaffold registry + foundation in project
 *   tincture codegen                         — re-emit _generated/ from registry
 *   tincture validate                        — run registry validator
 *   tincture create                          — create a new token
 *   tincture scan                            — find hardcoded colors in CSS / Tailwind / inline
 *   tincture scan-tailwind                   — scan Tailwind classes for tokenization
 *   tincture verify                          — check token usage matches declarations
 *   tincture contrast                        — WCAG 2.1 + APCA matrix per surface
 *   tincture apply-typography                — auto-migrate heading typography to tokens
 *   tincture mood list                       — list mood presets
 *   tincture mood apply <name>               — apply a coordinated palette delta
 *   tincture palette                         — SVG visual of current palette
 *   tincture preview                         — preview output
 *
 * Output: human (default) or --json. Exit code: 0 success, 1 not-found,
 * 2 invalid-input, 3 substrate-error.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
import { REGISTRY_PATH, MANIFEST_PATH, MOODS_DIR } from './_resolve-config.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const pkg = JSON.parse(readFileSync(resolve(ROOT, '..', 'package.json'), 'utf8'));

function flagValue(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error('✖ registry.json missing');
    process.exit(3);
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('✖ manifest.json missing — run `tincture codegen` first');
    process.exit(3);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function out(data) {
  if (jsonOut) console.log(JSON.stringify(data, null, 2));
  else if (typeof data === 'string') console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

// ── Terminal helpers ───────────────────────────────────────────────────

function colorBlock(hex) {
  // Render a hex color as an ANSI true-color block
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;
}

function colorBar(hex, width = 16) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bar = [];
  for (let i = 0; i < width; i++) {
    const t = i / width;
    const nr = Math.round(r * (1 - t) + 255 * t);
    const ng = Math.round(g * (1 - t) + 255 * t);
    const nb = Math.round(b * (1 - t) + 255 * t);
    bar.push(`\x1b[48;2;${nr};${ng};${nb}m \x1b[0m`);
  }
  return bar.join('');
}

function walk(dir, exts = ['.tsx'], skip = ['node_modules', '.next', '.git', 'dist', '_generated']) {
  if (!existsSync(dir)) return [];
  const list = [];
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) list.push(...walk(p, exts, skip));
    else if (exts.some((e) => p.endsWith(e))) list.push(p);
  }
  return list;
}

// ── Verbs ───────────────────────────────────────────────────────────────

const verbs = {

  // ── Status ────────────────────────────────────────────────────────────

  status: () => {
    const hasReg = existsSync(REGISTRY_PATH);
    const hasMan = existsSync(MANIFEST_PATH);
    const hasMoods = existsSync(MOODS_DIR);

    console.log(`\n  tincture ${pkg.version}\n`);

    if (hasReg) {
      const reg = loadRegistry();
      const tokenCount = Object.keys(reg.semantic ?? reg.tokens ?? {}).length;
      const surfaceCount = (reg.surfaces ?? reg.meta?.surfaces ?? []).length;
      const moodCount = hasMoods ? readdirSync(MOODS_DIR).filter(f => f.endsWith('.json')).length : 0;
      const compCount = hasMan ? Object.keys(loadManifest().components ?? {}).length : 0;

      console.log(`  ${tokenCount} tokens  ·  ${surfaceCount} surfaces  ·  ${moodCount} moods  ·  ${compCount} components`);
      console.log(`  registry:  ${REGISTRY_PATH.replace(ROOT, '.')}`);
      if (hasMan) console.log(`  manifest:  ${MANIFEST_PATH.replace(ROOT, '.')}`);
    } else {
      console.log(`  No registry found. Run \`tincture init\` to scaffold one.`);
    }
    console.log('');
  },

  // ── Tokens ────────────────────────────────────────────────────────────

  'tokens list': () => {
    const m = loadManifest();
    const tokens = Object.entries(m.tokens).map(([id, t]) => ({
      id, role: t.role,
      lightValue: t.lightValue, darkValue: t.darkValue, doc: t.doc,
    }));
    if (jsonOut) return out(tokens);
    console.log(`\n  ${tokens.length} token(s)\n`);
    for (const t of tokens) {
      const lBlock = t.lightValue ? colorBlock(t.lightValue) : '  ';
      const dBlock = t.darkValue ? colorBlock(t.darkValue) : '  ';
      console.log(`  ${lBlock}${dBlock}  --${t.id.padEnd(18)} ${t.doc ?? ''}`);
    }
    console.log('');
  },

  'tokens get': () => {
    const id = args[2];
    if (!id) { console.error('usage: tincture tokens get <id>'); process.exit(2); }
    const m = loadManifest();
    const t = m.tokens[id];
    if (!t) { console.error(`✖ token "${id}" not found`); process.exit(1); }
    if (jsonOut) return out({ id, ...t });
    const lBlock = t.lightValue ? colorBlock(t.lightValue) : '';
    const dBlock = t.darkValue ? colorBlock(t.darkValue) : '';
    console.log(`\n  --${id}`);
    console.log(`  ${lBlock} light  ${t.lightValue ?? '—'}`);
    console.log(`  ${dBlock} dark   ${t.darkValue ?? '—'}`);
    console.log(`  role: ${t.role ?? '—'}`);
    if (t.doc) console.log(`  ${t.doc}`);
    console.log('');
  },

  'tokens find': () => {
    const role = flagValue('role');
    const legacy = flagValue('legacy');
    const m = loadManifest();
    const matches = Object.entries(m.tokens).filter(([id, t]) => {
      if (role && t.role !== role) return false;
      if (legacy && !(t.legacy ?? []).includes(legacy)) return false;
      return true;
    }).map(([id, t]) => ({ id, ...t }));
    out(matches);
  },

  'tokens impact': () => {
    const id = args[2];
    if (!id) { console.error('usage: tincture tokens impact <id>'); process.exit(2); }
    const m = loadManifest();
    if (!m.tokens[id]) { console.error(`✖ token "${id}" not found`); process.exit(1); }

    const t = m.tokens[id];
    const patterns = [`var(--${id})`, ...(t.legacy ?? []).map((l) => `var(${l})`)];
    const files = walk(process.cwd(), ['.tsx', '.ts', '.css']);
    const hits = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const p of patterns) {
        const count = content.split(p).length - 1;
        if (count > 0) hits.push({ file: file.slice(ROOT.length + 1), pattern: p, count });
      }
    }

    const components = [];
    for (const [name, comp] of Object.entries(m.components ?? {})) {
      if ((comp['tokens-read'] ?? []).includes(id))
        components.push({ name, file: comp.file, surfaces: comp.surfaces });
    }

    if (jsonOut) return out({ token: id, components, hits });
    console.log(`\n  --${id} impact`);
    console.log(`  ${components.length} component(s) · ${hits.length} source reference(s)\n`);
    for (const c of components) console.log(`    ${c.name.padEnd(22)} ${c.file}`);
    for (const h of hits) console.log(`    ${h.count.toString().padStart(2)}×  ${h.file}`);
    console.log('');
  },

  'tokens set': () => {
    const id = args[2];
    const light = flagValue('light');
    const dark = flagValue('dark');
    if (!id || (!light && !dark)) {
      console.error('usage: tincture tokens set <id> [--light <hex>] [--dark <hex>]');
      process.exit(2);
    }
    const reg = loadRegistry();
    if (!reg.semantic[id]) { console.error(`✖ token "${id}" not in registry`); process.exit(1); }
    if (light) reg.semantic[id].lightValue = light;
    if (dark) reg.semantic[id].darkValue = dark;
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8');
    execSync(`node ${resolve(__dirname, 'codegen.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`\n  ✓ ${id} updated\n`);
  },

  // ── Moods ────────────────────────────────────────────────────────────

  'mood list': () => {
    if (!existsSync(MOODS_DIR)) {
      console.log('  no moods yet\n');
      return;
    }
    const files = readdirSync(MOODS_DIR).filter((f) => f.endsWith('.json'));
    console.log(`\n  ${files.length} mood(s)\n`);
    for (const f of files) {
      const mood = JSON.parse(readFileSync(join(MOODS_DIR, f), 'utf8'));
      const deltas = Object.values(mood.deltas ?? {}).filter(d => d && d.value);
      const samples = deltas.slice(0, 3).map(d => d.value).filter(Boolean);
      const bar = samples.length ? colorBar(samples[0]) : '';
      console.log(`  ${mood.id.padEnd(22)} ${bar}  ${mood.doc ?? ''}`);
    }
    console.log('');
  },

  'mood apply': () => {
    const name = args[2];
    if (!name) { console.error('usage: tincture mood apply <name>'); process.exit(2); }
    execSync(`node ${resolve(__dirname, 'mood.mjs')} apply ${name}`, { cwd: ROOT, stdio: 'inherit' });
  },

  // ── Pipeline stages ──────────────────────────────────────────────────

  init: () => {
    execSync(`node ${resolve(__dirname, 'init.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  codegen: () => {
    execSync(`node ${resolve(__dirname, 'codegen.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  validate: () => {
    execSync(`node ${resolve(__dirname, 'validate.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  create: () => {
    execSync(`node ${resolve(__dirname, 'create.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  scan: () => {
    execSync(`node ${resolve(__dirname, 'scan-css.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'scan-tailwind': () => {
    execSync(`node ${resolve(__dirname, 'scan-tailwind.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  verify: () => {
    execSync(`node ${resolve(__dirname, 'verify.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  contrast: () => {
    execSync(`node ${resolve(__dirname, 'contrast.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'apply-typography': () => {
    execSync(`node ${resolve(__dirname, 'apply-typography.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  palette: () => {
    execSync(`node ${resolve(__dirname, 'palette.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  preview: () => {
    execSync(`node ${resolve(__dirname, 'preview.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },
};

// ── Dispatch ────────────────────────────────────────────────────────────

const cmd = `${args[0] ?? ''} ${args[1] ?? ''}`.trim();
const fn = verbs[cmd] ?? verbs[args[0]];

if (!fn) {
  const version = pkg.version ?? '0.x';
  console.log(`\n  \x1b[1mtincture ${version}\x1b[0m  —  a drop changes the whole pour`);
  console.log(`  \x1b[2mBuild-time CSS token system. Declare once, cascade everywhere.\x1b[0m\n`);
  console.log(`  \x1b[1mTokens\x1b[0m`);
  console.log(`    tokens list|get|find|impact|set    inspect and edit tokens`);
  console.log(`  \x1b[1mPipeline\x1b[0m`);
  console.log(`    init|codegen|validate|create       scaffold, build, verify`);
  console.log(`  \x1b[1mAudit\x1b[0m`);
  console.log(`    scan|scan-tailwind|verify|contrast  find gaps, check contrast`);
  console.log(`    apply-typography                    migrate headings to tokens`);
  console.log(`  \x1b[1mMood\x1b[0m`);
  console.log(`    mood list|apply                    preview or shift the palette`);
  console.log(`  \x1b[1mVisualize\x1b[0m`);
  console.log(`    palette|preview|status             SVG, preview, project state`);
  console.log(`\n  \x1b[2mPass --json for machine output. Docs: README.md\x1b[0m\n`);
  process.exit(args.length === 0 ? 0 : 2);
}

fn();
