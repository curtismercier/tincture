#!/usr/bin/env node
/**
 * tincture.mjs — cycle 8.
 *
 * The Tincture CLI. Structured ops over the registry + manifest.
 * Designed so an agent (Claude/MCP) or a human can edit tokens, query
 * impact, apply moods, and audit contrast via predictable verbs.
 *
 * Usage:
 *   tincture tokens list                       — list all semantic tokens
 *   tincture tokens get <id>                   — single token detail
 *   tincture tokens find --role <r>            — query by role
 *   tincture tokens find --legacy <name>       — find which token absorbs a legacy alias
 *   tincture tokens impact <id>                — components + pages affected by changing this
 *   tincture tokens set <id> --light <hex> --dark <hex> — write to registry, regen
 *   tincture init                              — scaffold registry + foundation in project
 *   tincture scan                              — find hardcoded colors in CSS / Tailwind / inline
 *   tincture codegen                           — re-emit _generated/ from registry
 *   tincture verify                            — check token usage matches declarations
 *   tincture contrast                          — WCAG 2.1 + APCA matrix per surface
 *   tincture mood list                         — list mood presets
 *   tincture mood apply <name>                 — apply a coordinated palette delta
 *   tincture palette                           — SVG visual of current palette
 *   tincture preview                           — preview output
 *   tincture validate                          — run registry validator
 *   tincture create                            — create a new token
 *
 * Output: human (default) or --json. Exit code 0 success, 1 not-found,
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
function flagValue(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error('x registry.json missing');
    process.exit(3);
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}
function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('x manifest.json missing — run `tincture codegen` first');
    process.exit(3);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function out(data) {
  if (jsonOut) console.log(JSON.stringify(data, null, 2));
  else if (typeof data === 'string') console.log(data);
  else console.log(JSON.stringify(data, null, 2));
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
  'tokens list': () => {
    const m = loadManifest();
    const tokens = Object.entries(m.tokens).map(([id, t]) => ({
      id,
      role: t.role,
      lightValue: t.lightValue,
      darkValue: t.darkValue,
      doc: t.doc,
    }));
    if (jsonOut) return out(tokens);
    out(`${tokens.length} semantic token(s):`);
    for (const t of tokens) {
      out(`  --${t.id.padEnd(15)} role=${(t.role ?? '?').padEnd(20)}  light=${t.lightValue}  dark=${t.darkValue}`);
    }
  },

  'tokens get': () => {
    const id = args[2];
    if (!id) { console.error('usage: tincture tokens get <id>'); process.exit(2); }
    const m = loadManifest();
    const t = m.tokens[id];
    if (!t) { console.error(`x token "${id}" not found`); process.exit(1); }
    out({ id, ...t });
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
    if (!m.tokens[id]) { console.error(`x token "${id}" not found`); process.exit(1); }

    // Walk source for any reference to var(--<id>) or its legacy aliases
    const t = m.tokens[id];
    const patterns = [`var(--${id})`, ...(t.legacy ?? []).map((l) => `var(${l})`)];

    const files = walk(process.cwd(), ['.tsx', '.ts', '.css']);
    const hits = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const p of patterns) {
        const count = content.split(p).length - 1;
        if (count > 0) {
          hits.push({ file: file.slice(ROOT.length + 1), pattern: p, count });
        }
      }
    }

    // Find components in registry that read this token
    const components = [];
    for (const [name, comp] of Object.entries(m.components ?? {})) {
      if ((comp['tokens-read'] ?? []).includes(id)) {
        components.push({ name, file: comp.file, surfaces: comp.surfaces });
      }
    }

    if (jsonOut) return out({ token: id, components, hits });
    out(`token --${id} impact:`);
    out('');
    out(`  ${components.length} component(s) declare reading this token:`);
    for (const c of components) out(`    ${c.name.padEnd(20)} ${c.file}  surfaces=${c.surfaces.join(',')}`);
    out('');
    out(`  ${hits.length} source file(s) reference this token (or its legacy aliases):`);
    for (const h of hits) out(`    ${h.count.toString().padStart(3)}  ${h.file}  via ${h.pattern}`);
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
    if (!reg.semantic[id]) { console.error(`x token "${id}" not in registry`); process.exit(1); }
    if (light) reg.semantic[id].lightValue = light;
    if (dark)  reg.semantic[id].darkValue = dark;
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8');
    // Regen
    execSync(`node ${resolve(__dirname, 'codegen.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
    out(`✓ token "${id}" updated. Regenerated _generated/.`);
  },

  'mood list': () => {
    
    if (!existsSync(MOODS_DIR)) {
      out('no moods authored yet (cycle 12+).');
      return;
    }
    const files = readdirSync(MOODS_DIR).filter((f) => f.endsWith('.json'));
    out(`${files.length} mood preset(s):`);
    for (const f of files) {
      const mood = JSON.parse(readFileSync(join(MOODS_DIR, f), 'utf8'));
      out(`  ${mood.id.padEnd(20)} ${mood.doc ?? ''}`);
    }
  },

  'mood apply': () => {
    const name = args[2];
    if (!name) { console.error('usage: tincture mood apply <name>'); process.exit(2); }
    execSync(`node ${resolve(__dirname, 'mood.mjs')} apply ${name}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'validate': () => {
    execSync(`node ${resolve(__dirname, 'validate.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'codegen': () => {
    execSync(`node ${resolve(__dirname, 'codegen.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'contrast': () => {
    execSync(`node ${resolve(__dirname, 'contrast.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'init': () => {
    execSync(`node ${resolve(__dirname, 'init.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'scan': () => {
    execSync(`node ${resolve(__dirname, 'scan-css.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'verify': () => {
    execSync(`node ${resolve(__dirname, 'verify.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'palette': () => {
    execSync(`node ${resolve(__dirname, 'palette.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'preview': () => {
    execSync(`node ${resolve(__dirname, 'preview.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },

  'create': () => {
    execSync(`node ${resolve(__dirname, 'create.mjs')}`, { cwd: ROOT, stdio: 'inherit' });
  },
};

// ── Dispatch ────────────────────────────────────────────────────────────

const cmd = `${args[0] ?? ''} ${args[1] ?? ''}`.trim();
const fn = verbs[cmd] ?? verbs[args[0]];

if (!fn) {
  console.log(`tincture — substrate CLI for Phase 3 (cycle 8).\n`);
  console.log(`Verbs:`);
  for (const v of Object.keys(verbs)) console.log(`  tincture ${v}`);
  process.exit(args.length === 0 ? 0 : 2);
}

fn();
