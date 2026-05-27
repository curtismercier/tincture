#!/usr/bin/env node
/**
 * contrast.mjs — WCAG 2.1 + APCA contrast matrix for a Tincture registry.
 *
 * For every foreground × background token pair declared in registry.json,
 * resolves the colors per surface (light, dark, custom), composites
 * translucent backgrounds over the page bg, and computes:
 *   - WCAG 2.1 contrast ratio (the legal/compliance standard)
 *   - APCA |Lc| (the W3 draft perceptual standard, used by axe-core 4.7+)
 *
 * Output: markdown matrix (default), JSON (--json), or fail-only (--check).
 *
 * Usage:
 *   tincture contrast                         # current registry, all surfaces
 *   tincture contrast --surface light         # one surface only
 *   tincture contrast --check                 # exit 1 if any pair fails
 *   tincture contrast --json                  # machine-readable
 *   tincture contrast --registry path/to.json # custom path
 *
 * Verdict per cell:
 *   ✅ both pass     — WCAG ≥ 4.5 AND APCA |Lc| ≥ 75
 *   🟡 one passes    — heading/large-text safe but not body
 *   🔴 both fail     — WCAG < 3.0 OR APCA |Lc| < 45
 *
 * Why two algorithms?
 *   WCAG 2.1 is luminance-ratio based. It's the legal standard. It also
 *   misses real readability problems with mid-tone colors, and over-flags
 *   light-on-dark inversions.
 *
 *   APCA is perceptual + polarity-aware. It's the W3 draft for WCAG 3 and
 *   the algorithm axe-core 4.7+ runs internally. When the two disagree,
 *   APCA is usually closer to "can a person actually read this."
 *
 *   Tincture reports both. Disagreement is the signal.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f, fallback) => {
  const i = args.findIndex(a => a === `--${f}` || a.startsWith(`--${f}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
};

let registryPath = arg('registry');
if (!registryPath) {
  // Try _resolve-config.mjs first, then fall back to common locations
  try {
    const cfg = await import('./_resolve-config.mjs');
    registryPath = cfg.REGISTRY_PATH;
  } catch {
    const candidates = [
      resolve(process.cwd(), 'tincture/registry.json'),
      resolve(process.cwd(), 'src/styles/tincture/registry.json'),
    ];
    registryPath = candidates.find(f => existsSync(f)) || candidates[0];
  }
}
const surfaceFilter = arg('surface', null);

if (!existsSync(registryPath)) {
  console.error(`registry not found: ${registryPath}`);
  console.error(`hint: pass --registry <path> or run from project root`);
  process.exit(2);
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

// ─── Color parsing ───────────────────────────────────────────────────────
function parseColor(s) {
  s = (s || '').toString().trim();
  let m = s.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16), 1];
    if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
    if (h.length === 8) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16)/255];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
  return null;
}

// ─── Composite over base ─────────────────────────────────────────────────
function compositeOver(top, base) {
  const a = top[3] ?? 1;
  return [
    Math.round(top[0]*a + base[0]*(1-a)),
    Math.round(top[1]*a + base[1]*(1-a)),
    Math.round(top[2]*a + base[2]*(1-a)),
    1,
  ];
}

// ─── WCAG 2.1 ────────────────────────────────────────────────────────────
function relLuminance([r, g, b]) {
  const ch = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b);
}
function contrastRatio(c1, c2) {
  const L1 = relLuminance(c1), L2 = relLuminance(c2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── APCA Lc (Myndex/apca-w3 algorithm, MIT) ─────────────────────────────
function sRGBtoY([r, g, b]) {
  const ch = c => Math.pow(c/255, 2.4);
  return 0.2126729*ch(r) + 0.7151522*ch(g) + 0.0721750*ch(b);
}
function apcaContrast(txt, bg) {
  const SA = {
    blkThrs: 0.022, blkClmp: 1.414,
    scaleBoW: 1.14, normBG: 0.56, normTXT: 0.57,
    revTXT: 0.62, revBG: 0.65, scaleWoB: 1.14,
    loBoWoffset: 0.027, loWoBoffset: 0.027,
    deltaYmin: 0.0005, loClip: 0.1,
  };
  let txtY = sRGBtoY(txt), bgY = sRGBtoY(bg);
  txtY = (txtY > SA.blkThrs) ? txtY : txtY + Math.pow(SA.blkThrs - txtY, SA.blkClmp);
  bgY  = (bgY  > SA.blkThrs) ? bgY  : bgY  + Math.pow(SA.blkThrs - bgY,  SA.blkClmp);
  if (Math.abs(bgY - txtY) < SA.deltaYmin) return 0.0;
  let SAPC, out;
  if (bgY > txtY) {
    SAPC = (Math.pow(bgY, SA.normBG) - Math.pow(txtY, SA.normTXT)) * SA.scaleBoW;
    out = SAPC < SA.loClip ? 0 : SAPC - SA.loBoWoffset;
  } else {
    SAPC = (Math.pow(bgY, SA.revBG) - Math.pow(txtY, SA.revTXT)) * SA.scaleWoB;
    out = SAPC > -SA.loClip ? 0 : SAPC + SA.loWoBoffset;
  }
  return out * 100;
}

// ─── Resolve all token values per surface ────────────────────────────────
function resolveForSurface(registry, surface) {
  const out = new Map();
  for (const [name, tok] of Object.entries(registry.tokens || {})) {
    if (tok.kind && tok.kind !== 'color') continue;
    const values = tok.values || {};
    const key = `surface=${surface}`;
    const raw = values[key] || values.default;
    if (!raw) continue;
    const c = parseColor(raw);
    if (c) out.set(name, c);
  }
  return out;
}

// ─── Detect surface variants present in the registry ─────────────────────
function detectSurfaces(registry) {
  const set = new Set(['default']);
  for (const tok of Object.values(registry.tokens || {})) {
    for (const k of Object.keys(tok.values || {})) {
      const m = k.match(/^surface=(.+)$/);
      if (m) set.add(m[1]);
    }
  }
  // 'default' implies whichever surface was tuned for it; we expose it as 'dark'
  // by convention (default = dark surface) — adjust if your project differs.
  return [...set].filter(s => s !== 'default');
}

// ─── Heuristics for fg vs bg token roles ─────────────────────────────────
function isLikelyFg(name) {
  return /^--?(?:ink|text|fg|color|promo(?:-text|-dim)?|accent|warm|moon|sun-text|brand)/.test(name) ||
         /-text$|-fg$/.test(name);
}
function isLikelyBg(name) {
  return /^--?(?:bg|background|surface|panel|card|elev|shadow)/.test(name) ||
         /-bg$|-card$|-elev$/.test(name);
}

// ─── Verdict per pair ────────────────────────────────────────────────────
function verdict(wcag, apca) {
  const apcaAbs = Math.abs(apca);
  const wcagPass = wcag >= 4.5;
  const apcaPass = apcaAbs >= 75;
  if (wcagPass && apcaPass) return '✅';
  if (wcag < 3 || apcaAbs < 45) return '🔴';
  return '🟡';
}

// ─── Format matrix ───────────────────────────────────────────────────────
function buildMatrix(registry, surface, baseBgRgba) {
  const resolved = resolveForSurface(registry, surface);
  const fgNames = [...resolved.keys()].filter(isLikelyFg).map(n => n.startsWith('--') ? n : `--${n}`);
  const bgNames = [...resolved.keys()].filter(isLikelyBg).map(n => n.startsWith('--') ? n : `--${n}`);
  const rows = [];
  for (const fg of fgNames) {
    const fgRaw = resolved.get(fg.replace(/^--/, '')) || resolved.get(fg);
    if (!fgRaw) continue;
    const cells = [];
    for (const bg of bgNames) {
      const bgRaw = resolved.get(bg.replace(/^--/, '')) || resolved.get(bg);
      if (!bgRaw) { cells.push({ bg, wcag: null, apca: null, verdict: '_-_' }); continue; }
      const bgEff = compositeOver(bgRaw, baseBgRgba);
      const wcag = contrastRatio(fgRaw.slice(0,3), bgEff.slice(0,3));
      const apca = apcaContrast(fgRaw.slice(0,3), bgEff.slice(0,3));
      cells.push({ bg, wcag, apca, verdict: verdict(wcag, apca) });
    }
    rows.push({ fg, cells });
  }
  return { surface, fgNames, bgNames, rows };
}

// ─── Render markdown ─────────────────────────────────────────────────────
function fmtMatrix(matrix) {
  const out = [];
  out.push(`## Surface: \`${matrix.surface}\`\n`);
  if (!matrix.rows.length) {
    out.push('_No fg × bg pairs detected. Check token naming heuristics._\n');
    return out.join('\n');
  }
  out.push(`| FG \\ BG | ${matrix.bgNames.map(n => `\`${n}\``).join(' | ')} |`);
  out.push(`|${'---|'.repeat(matrix.bgNames.length + 1)}`);
  for (const row of matrix.rows) {
    const cells = row.cells.map(c => {
      if (c.wcag === null) return c.verdict;
      return `${c.wcag.toFixed(1)} / Lc${Math.abs(c.apca).toFixed(0)} ${c.verdict}`;
    });
    out.push(`| \`${row.fg}\` | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  const surfaces = surfaceFilter ? [surfaceFilter] : detectSurfaces(registry);
  if (!surfaces.length) {
    console.error('no surfaces detected in registry. did you set "axes": ["surface"] on your color tokens?');
    process.exit(2);
  }

  const matrices = surfaces.map(s => {
    // Default base bg per surface — used for translucent compositing
    const base = s === 'light' ? [232, 238, 245, 1] : [12, 15, 22, 1];
    return buildMatrix(registry, s, base);
  });

  if (has('json')) {
    console.log(JSON.stringify({ surfaces: matrices.map(m => ({
      surface: m.surface,
      fgNames: m.fgNames,
      bgNames: m.bgNames,
      rows: m.rows,
    })) }, null, 2));
    return;
  }

  if (has('check')) {
    let failed = 0;
    for (const m of matrices) for (const row of m.rows) for (const cell of row.cells)
      if (cell.verdict === '🔴') failed++;
    console.error(`contrast: ${failed} pair(s) failed both WCAG and APCA thresholds`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Markdown report
  console.log(`# Contrast — ${registry.name || 'tincture registry'}\n`);
  console.log(`Format per cell: \`WCAG / Lc<APCA> verdict\`. ✅ both pass · 🟡 one passes (heading/large only) · 🔴 both fail.\n`);
  console.log(`WCAG 2.1 thresholds: 4.5:1 body / 3:1 large.  APCA: |Lc| ≥ 75 body / 60 heading / 45 large.\n`);
  for (const m of matrices) console.log(fmtMatrix(m) + '\n');
}

main();
