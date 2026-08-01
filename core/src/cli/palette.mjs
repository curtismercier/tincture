#!/usr/bin/env node
/**
 * palette.mjs — generate an SVG visual of the current Tincture registry.
 *
 * Reads tincture/registry.json, renders every color token as a swatch
 * grouped by surface. Each swatch shows: token name, resolved hex value,
 * and contrast (WCAG ratio + APCA Lc) against that surface's --bg.
 *
 * Output: SVG to stdout (default), or write to --out <path>.
 *
 * Usage:
 *   tincture palette                           # SVG to stdout
 *   tincture palette --out ./palette.svg       # write file
 *   tincture palette --surface light           # one surface only
 *   tincture palette --registry path/to.json   # custom registry path
 *   tincture palette --width 1200              # custom viewport width
 *
 * Design intent: produce a share-ready visual for design-review PRs and
 * docs. Every cell is annotated with its hex value and contrast verdict
 * so reviewers can spot weak pairs without reaching for devtools.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f, fallback) => {
  const i = args.findIndex(a => a === `--${f}` || a.startsWith(`--${f}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
};

const registryPath = arg('registry', resolve(process.cwd(), 'src/styles/tincture/registry.json'));
const surfaceFilter = arg('surface', null);
const outPath = arg('out', null);
const width = parseInt(arg('width', '900'), 10);

if (!existsSync(registryPath)) {
  console.error(`registry not found: ${registryPath}`);
  process.exit(2);
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

// ─── Color parsing + contrast ────────────────────────────────────────────
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
  const SA = { blkThrs: 0.022, blkClmp: 1.414, scaleBoW: 1.14, normBG: 0.56, normTXT: 0.57,
               revTXT: 0.62, revBG: 0.65, scaleWoB: 1.14, loBoWoffset: 0.027, loWoBoffset: 0.027,
               deltaYmin: 0.0005, loClip: 0.1 };
  let txtY = sRGBtoY(txt), bgY = sRGBtoY(bg);
  txtY = (txtY > SA.blkThrs) ? txtY : txtY + Math.pow(SA.blkThrs - txtY, SA.blkClmp);
  bgY  = (bgY  > SA.blkThrs) ? bgY  : bgY  + Math.pow(SA.blkThrs - bgY,  SA.blkClmp);
  if (Math.abs(bgY - txtY) < SA.deltaYmin) return 0.0;
  let SAPC, lc;
  if (bgY > txtY) {
    SAPC = (Math.pow(bgY, SA.normBG) - Math.pow(txtY, SA.normTXT)) * SA.scaleBoW;
    lc = SAPC < SA.loClip ? 0 : SAPC - SA.loBoWoffset;
  } else {
    SAPC = (Math.pow(bgY, SA.revBG) - Math.pow(txtY, SA.revTXT)) * SA.scaleWoB;
    lc = SAPC > -SA.loClip ? 0 : SAPC + SA.loWoBoffset;
  }
  return lc * 100;
}

// ─── Detect surfaces + resolve all token values per surface ──────────────
function detectSurfaces(registry) {
  const explicit = new Set();
  for (const tok of Object.values(registry.tokens || {})) {
    for (const k of Object.keys(tok.values || {})) {
      const m = k.match(/^surface=(.+)$/);
      if (m) explicit.add(m[1]);
    }
  }
  // The 'default' value is the canonical/fallback. By convention, default = dark
  // surface (deep-space ink). Render it as 'dark' first, then any explicit
  // surface variants.
  const result = ['dark'];
  for (const s of explicit) if (s !== 'dark') result.push(s);
  return result;
}

function resolveForSurface(registry, surface) {
  const out = [];
  for (const [name, tok] of Object.entries(registry.tokens || {})) {
    if (tok.kind && tok.kind !== 'color') continue;
    const values = tok.values || {};
    const explicitKey = `surface=${surface}`;
    // 'dark' surface convention: prefer explicit dark, fall back to default.
    // Other surfaces: prefer explicit, then default.
    let raw = values[explicitKey] || values.default;
    if (!raw) continue;
    out.push({ name, raw, doc: tok.doc || '' });
  }
  return out;
}

// ─── SVG ─────────────────────────────────────────────────────────────────
function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function pickContrastColor(rgb) {
  // Black or white text — whichever has higher contrast against the bg
  const black = contrastRatio(rgb, [0,0,0]);
  const white = contrastRatio(rgb, [255,255,255]);
  return white > black ? '#ffffff' : '#0a0f1a';
}

// Group tokens by semantic family from name prefix.
function groupByFamily(tokens) {
  const groups = new Map();
  const order = ['surfaces', 'text', 'accent', 'promo', 'sun', 'borders', 'shadows', 'other'];
  for (const t of tokens) {
    const n = t.name;
    let group = 'other';
    if (/^(?:bg|surface)/.test(n)) group = 'surfaces';
    else if (/^(?:ink|text|fg)/.test(n)) group = 'text';
    else if (/^accent/.test(n)) group = 'accent';
    else if (/^promo/.test(n)) group = 'promo';
    else if (/^sun/.test(n)) group = 'sun';
    else if (/border/.test(n)) group = 'borders';
    else if (/shadow/.test(n)) group = 'shadows';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(t);
  }
  // Return in canonical order
  return order.filter(g => groups.has(g)).map(g => [g, groups.get(g)]);
}

function buildSurfaceSection(name, label, tokens, bgRgba, x, y, surfaceWidth) {
  const baseBg = bgRgba.slice(0, 3);
  const SWATCH_W = 196;
  const SWATCH_H = 88;
  const GAP_X = 12;
  const GAP_Y = 14;
  const GROUP_GAP = 18;
  const PER_ROW = Math.max(1, Math.floor((surfaceWidth - 40) / (SWATCH_W + GAP_X)));
  const labelColor = pickContrastColor(baseBg);

  const parts = [];
  parts.push(`<g transform="translate(${x},${y})">`);
  parts.push(`<text x="20" y="4" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="${labelColor}">${escape(label)}</text>`);
  parts.push(`<text x="20" y="24" font-family="system-ui,sans-serif" font-size="12" fill="${labelColor}" opacity="0.65">${escape(name === 'dark' ? 'data-surface="dark"' : `data-surface="${name}"`)} — contrast scored against this surface’s --bg</text>`);

  let cursorY = 50;
  const groups = groupByFamily(tokens);
  for (const [groupName, items] of groups) {
    parts.push(`<text x="20" y="${cursorY}" font-family="ui-monospace,Menlo,monospace" font-size="11" fill="${labelColor}" opacity="0.55" letter-spacing="0.1em">${escape(groupName.toUpperCase())}</text>`);
    cursorY += 12;
    let i = 0;
    for (const t of items) {
      const c = parseColor(t.raw);
      if (!c) { i++; continue; }
      const composite = compositeOver(c, [...bgRgba.slice(0,3), 1]);
      const fill = `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
      const wcag = contrastRatio(c.slice(0,3), baseBg);
      const lc = Math.abs(apcaContrast(c.slice(0,3), baseBg));
      const verdict = (wcag >= 4.5 && lc >= 75) ? '✅' :
                      (wcag >= 3 || lc >= 45) ? '🟡' : '🔴';
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const sx = 20 + col * (SWATCH_W + GAP_X);
      const sy = cursorY + row * (SWATCH_H + GAP_Y);
      const swatchLabelColor = pickContrastColor(composite.slice(0,3));
      parts.push(`<g transform="translate(${sx},${sy})">`);
      parts.push(`<rect width="${SWATCH_W}" height="${SWATCH_H}" rx="8" fill="${fill}" stroke="rgba(0,0,0,0.10)" stroke-width="1"/>`);
      parts.push(`<text x="10" y="22" font-family="ui-monospace,Menlo,monospace" font-size="11" fill="${swatchLabelColor}">--${escape(t.name)}</text>`);
      parts.push(`<text x="10" y="40" font-family="ui-monospace,Menlo,monospace" font-size="10" fill="${swatchLabelColor}" opacity="0.78">${escape(t.raw)}</text>`);
      parts.push(`<text x="10" y="${SWATCH_H - 10}" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${swatchLabelColor}" opacity="0.65">${wcag.toFixed(1)} / Lc${lc.toFixed(0)} ${verdict}</text>`);
      parts.push(`</g>`);
      i++;
    }
    const rows = Math.ceil(i / PER_ROW);
    cursorY += rows * (SWATCH_H + GAP_Y) + GROUP_GAP;
  }
  parts.push(`</g>`);
  return { svg: parts.join(''), height: cursorY + 8 };
}

function buildSVG(registry, surfaces) {
  const HEADER_H = 96;
  const surfaceBlocks = [];
  let y = HEADER_H;
  for (const s of surfaces) {
    const tokens = resolveForSurface(registry, s);
    if (!tokens.length) continue;
    // Find this surface's --bg value for the section background
    const bgTok = tokens.find(t => t.name === 'bg' || t.name === '--bg');
    const bgRgba = bgTok ? (parseColor(bgTok.raw) || [240,240,240,1]) : (s === 'dark' ? [12,15,22,1] : [232,238,245,1]);
    const block = buildSurfaceSection(s, `Surface: ${s}`, tokens, bgRgba, 0, y, width);
    surfaceBlocks.push({ block, bgRgba, y });
    y += block.height;
  }
  const totalH = y + 20;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalH}" width="${width}" height="${totalH}">`);
  parts.push(`<rect width="${width}" height="${totalH}" fill="#0c0f16"/>`);
  // Header (ink ON dark)
  parts.push(`<text x="20" y="42" font-family="system-ui,sans-serif" font-size="30" font-weight="800" fill="#e4eaf4">Tincture · ${escape(registry.name || 'palette')}</text>`);
  parts.push(`<text x="20" y="66" font-family="system-ui,sans-serif" font-size="13" fill="#9dafc4">${escape(registry.doc || 'Color tokens, surface-aware. Generated by tincture palette.')}</text>`);
  // Verdict legend
  parts.push(`<text x="${width - 20}" y="40" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="10" fill="#9dafc4">✅ WCAG≥4.5 · APCA |Lc|≥75 · 🟡 large-text only · 🔴 fail</text>`);
  parts.push(`<text x="${width - 20}" y="58" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="10" fill="#9dafc4">tincture palette — ${new Date().toISOString().slice(0,10)}</text>`);
  // Each surface block over its own bg color
  for (const sb of surfaceBlocks) {
    const bg = `rgb(${sb.bgRgba[0]},${sb.bgRgba[1]},${sb.bgRgba[2]})`;
    parts.push(`<rect x="0" y="${sb.y}" width="${width}" height="${sb.block.height}" fill="${bg}"/>`);
    parts.push(sb.block.svg);
  }
  parts.push(`</svg>`);
  return parts.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────
const surfaces = surfaceFilter ? [surfaceFilter] : detectSurfaces(registry);
const svg = buildSVG(registry, surfaces);
if (outPath) {
  writeFileSync(outPath, svg);
  process.stderr.write(`palette written: ${outPath}\n`);
} else {
  process.stdout.write(svg);
}
