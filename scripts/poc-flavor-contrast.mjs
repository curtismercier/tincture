#!/usr/bin/env node
/**
 * poc-flavor-contrast.mjs — PROOF OF CONCEPT for the flavor-axis audit
 * (cycles/flavor-axis-audit.md). NOT wired into the CLI.
 *
 * Demonstrates what contrast.mjs SHOULD do: evaluate every
 * (surface x secondAxis) cell, not just declared `surface=` cells.
 *
 * It does this the "bridge" way — parsing a hand-authored second-axis
 * CSS file ([data-<axis>="<value>"] blocks with light-dark() values)
 * and overlaying those overrides on the registry-resolved tokens —
 * because that is where the second axis currently LIVES for the real
 * consumer. The end-state design moves those values into the registry
 * (see the audit doc §Design); this script is the evidence step.
 *
 * Usage:
 *   node scripts/poc-flavor-contrast.mjs \
 *     --registry <registry.json> \
 *     --axis-css <flavors.css> \
 *     --axis-name flavor
 *
 * Exit 1 if any (fg x bg) pair fails BOTH WCAG (<3.0) and APCA (<45)
 * in any cell. Prints per-cell failures at body-text level too.
 */

import { readFileSync } from 'node:fs';

// ── args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (f, fallback) => {
  const i = args.findIndex(a => a === `--${f}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const REGISTRY = arg('registry');
const AXIS_CSS = arg('axis-css');
const AXIS = arg('axis-name', 'flavor');
if (!REGISTRY || !AXIS_CSS) {
  console.error('usage: poc-flavor-contrast.mjs --registry <json> --axis-css <css> [--axis-name flavor]');
  process.exit(2);
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const axisCss = readFileSync(AXIS_CSS, 'utf8');

// ── color math (same algorithms as src/cli/contrast.mjs) ────────────
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
function compositeOver(top, base) {
  const a = top[3] ?? 1;
  return [
    Math.round(top[0]*a + base[0]*(1-a)),
    Math.round(top[1]*a + base[1]*(1-a)),
    Math.round(top[2]*a + base[2]*(1-a)),
    1,
  ];
}
function relLuminance([r, g, b]) {
  const ch = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b);
}
function contrastRatio(c1, c2) {
  const L1 = relLuminance(c1), L2 = relLuminance(c2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
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

// ── FIXED role heuristics (contrast.mjs's require a leading dash that
//    bare registry ids never have — see audit doc §Findings F3) ──────
function isLikelyFg(name) {
  return /^(?:ink|text|fg|color|promo(?:-text|-dim)?|accent|warm|moon|sun-text|brand)/.test(name) ||
         /-text$|-fg$/.test(name);
}
function isLikelyBg(name) {
  return /^(?:bg|background|surface|panel|card|elev)/.test(name) ||
         /-bg$|-card$|-elev$/.test(name);
}

// ── resolve registry tokens per surface ─────────────────────────────
function resolveForSurface(surface) {
  const out = new Map();
  for (const [name, tok] of Object.entries(registry.tokens || {})) {
    if (tok.kind && tok.kind !== 'color') continue;
    const values = tok.values || {};
    const raw = values[`surface=${surface}`] ?? values.default;
    if (!raw) continue;
    const c = parseColor(raw);
    if (c) out.set(name, { raw, color: c });
  }
  return out;
}

// ── parse the axis CSS: [data-<axis>="v"] { --tok: value; } ─────────
// Handles light-dark(a, b): pick a on surface=light, b on surface=dark.
function parseAxisBlocks(css, axisName) {
  const blocks = {}; // value → { tokenName: rawValue }
  const blockRe = new RegExp(`\\[data-${axisName}="([a-z-]+)"\\]\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const [, value, body] = m;
    const decls = {};
    const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(body)) !== null) decls[d[1]] = d[2].trim();
    blocks[value] = Object.assign(blocks[value] || {}, decls);
  }
  return blocks;
}
function resolveLightDark(raw, surface) {
  const m = raw.match(/^light-dark\(\s*(.+?)\s*,\s*((?:rgba?\([^)]*\)|#[0-9a-fA-F]+|[^)]+?))\s*\)$/);
  if (!m) return raw;
  return surface === 'light' ? m[1].trim() : m[2].trim();
}

// ── surfaces: EVERY value of the surface axis, default included ─────
// (contrast.mjs only detects surfaces with declared `surface=` cells —
//  the default-side surface is silently skipped. Findings F2.)
const SURFACES = ['light', 'dark'];
const axisBlocks = parseAxisBlocks(axisCss, AXIS);
const AXIS_VALUES = Object.keys(axisBlocks);
if (!AXIS_VALUES.length) {
  console.error(`no [data-${AXIS}=...] blocks found in ${AXIS_CSS}`);
  process.exit(2);
}

// Canary (Trait 9): a pair that MUST pass and a pair that MUST fail,
// to prove the math + plumbing can produce both outcomes.
{
  const white = [255,255,255,1], black = [0,0,0,1], grey = [128,128,128,1];
  if (contrastRatio(white, black) < 20) { console.error('canary FAIL: white/black should be ~21'); process.exit(2); }
  if (contrastRatio(grey, [140,140,140,1]) > 1.2) { console.error('canary FAIL: near-identical greys should be ~1'); process.exit(2); }
}

// ── evaluate every (surface x axis-value) cell ──────────────────────
let hardFailures = 0;
const bodyFailures = []; // WCAG < 4.5 (body text level)
const rows = [];

for (const surface of SURFACES) {
  const base = resolveForSurface(surface);
  for (const axisValue of AXIS_VALUES) {
    // overlay axis overrides
    const cell = new Map(base);
    for (const [tok, raw] of Object.entries(axisBlocks[axisValue])) {
      const resolved = resolveLightDark(raw, surface);
      const c = parseColor(resolved);
      if (c) cell.set(tok, { raw: resolved, color: c });
    }
    const names = [...cell.keys()];
    const fgs = names.filter(isLikelyFg);
    const bgs = names.filter(isLikelyBg);
    const pageBg = cell.get('bg')?.color || (surface === 'light' ? [232,238,245,1] : [12,15,22,1]);

    for (const fg of fgs) {
      for (const bg of bgs) {
        const fgC = cell.get(fg).color;
        const bgC = compositeOver(cell.get(bg).color, pageBg);
        const wcag = contrastRatio(fgC.slice(0,3), bgC.slice(0,3));
        const apca = Math.abs(apcaContrast(fgC.slice(0,3), bgC.slice(0,3)));
        const cellId = `surface=${surface},${AXIS}=${axisValue}`;
        rows.push({ cell: cellId, fg, bg, wcag, apca });
        if (wcag < 3.0 && apca < 45) hardFailures++;
        if (wcag < 4.5) bodyFailures.push({ cell: cellId, fg, bg, wcag, apca });
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────
const cells = SURFACES.length * AXIS_VALUES.length;
console.log(`# PoC flavor-aware contrast — ${registry.name || REGISTRY}`);
console.log(`cells evaluated: ${cells} (${SURFACES.length} surfaces x ${AXIS_VALUES.length} ${AXIS}s)`);
console.log(`pairs evaluated: ${rows.length}`);
console.log(`hard failures (WCAG<3 AND APCA<45): ${hardFailures}`);
console.log(`body-text failures (WCAG<4.5): ${bodyFailures.length}\n`);

if (bodyFailures.length) {
  console.log(`| cell | fg | bg | WCAG | APCA |`);
  console.log(`|---|---|---|---|---|`);
  for (const f of bodyFailures.sort((a,b) => a.wcag - b.wcag)) {
    console.log(`| ${f.cell} | --${f.fg} | --${f.bg} | ${f.wcag.toFixed(2)} | Lc ${f.apca.toFixed(1)} |`);
  }
}
process.exit(hardFailures > 0 ? 1 : 0);
