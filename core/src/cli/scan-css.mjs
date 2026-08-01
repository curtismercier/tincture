#!/usr/bin/env node
/**
 * scan-styles.mjs — ASTRO-EXTRACT: comprehensive style auditor for Astro sites.
 *
 * Walks every .astro / .tsx / .ts / .css under src/, extracting:
 *   - CSS token definitions   (--name: value)
 *   - CSS token usages        (var(--name[, fallback]))
 *   - Hardcoded colors in     CSS, inline style="..", JSX style={{}}, SVG attrs
 *                             (fill, stroke, stop-color, color)
 *   - Each hit's surrounding selector context (the .class { ... } it lives in)
 *
 * Color analysis:
 *   - Each hardcoded color is matched against the registry tokens via
 *     CIE76 Δ-E in Lab space
 *   - Top match shown when confidence > 0.85 (Δ < 8)
 *
 * Modes:
 *   (default)              full markdown report
 *   --table                compact one-line-per-hit grouped by file
 *   --extract              every hit with surrounding line + suggested replacement (apply-ready)
 *   --component <path>     focus on a single file (full table for it)
 *   --token <name>         every define + every use of one token
 *   --orphans              defined but never used
 *   --missing              used but never defined
 *   --suggest              hardcoded → suggested token (sorted by Δ-E)
 *   --hardcoded            all hardcoded color values, sorted by file
 *   --json                 machine-readable
 *   --apply --dry-run      preview the rewrites --suggest would make
 *   --apply                actually rewrite (creates .bak files)
 *   --skip-generated       exclude tincture/_generated/ from input
 *   --threshold N          Δ-E threshold for suggestions (default 8)
 *
 * Examples:
 *   node scripts/scan-styles.mjs --table | less
 *   node scripts/scan-styles.mjs --component src/components/Nav.astro
 *   node scripts/scan-styles.mjs --suggest --threshold 6
 *   node scripts/scan-styles.mjs --apply --dry-run --threshold 4
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const ROOT = process.cwd();

// Resolve scan target from config (defaults to ./src). Allows projects
// with non-standard layouts (apps/, packages/, src/components/) to work.
let SRC = join(ROOT, 'src');
try {
  const { SCAN_DIR } = await import('./_resolve-config.mjs');
  if (SCAN_DIR) SRC = SCAN_DIR;
} catch {} // _resolve-config.mjs is optional

// ─── Walk ────────────────────────────────────────────────────────────────
function walk(dir, exts = ['.astro', '.tsx', '.ts', '.css', '.mjs', '.js'], { skipGenerated = false } = {}) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (skipGenerated && entry === '_generated') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, exts, { skipGenerated }));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

// ─── Color parsing + Lab distance ────────────────────────────────────────
function parseColor(s) {
  s = s.trim();
  // #RGB / #RRGGBB / #RRGGBBAA
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

// sRGB → linear → XYZ → Lab (D65)
function rgbToLab([r, g, b]) {
  const lin = c => (c /= 255, c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R*0.4124 + G*0.3576 + B*0.1805) / 0.95047;
  const Y =  R*0.2126 + G*0.7152 + B*0.0722;
  const Z = (R*0.0193 + G*0.1192 + B*0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116);
  return [116*f(Y) - 16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z))];
}
function deltaE(a, b) {
  const [L1,a1,b1] = a, [L2,a2,b2] = b;
  return Math.sqrt((L1-L2)**2 + (a1-a2)**2 + (b1-b2)**2);
}

// WCAG 2.1 relative luminance + contrast ratio
function relLuminance([r, g, b]) {
  const ch = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b);
}
function contrastRatio(c1, c2) {
  const L1 = relLuminance(c1), L2 = relLuminance(c2);
  const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (a + 0.05) / (b + 0.05);
}

// APCA contrast (Lc, perceptual — see Myndex/apca-w3, color.js).
// Polarity-aware: negative for light-on-dark. |Lc| ranges roughly 0-110.
// Thresholds (informally): ≥75 body text, ≥60 headings, ≥45 large text.
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
  let SAPC = 0, out = 0;
  if (bgY > txtY) {
    SAPC = (Math.pow(bgY, SA.normBG) - Math.pow(txtY, SA.normTXT)) * SA.scaleBoW;
    out = SAPC < SA.loClip ? 0 : SAPC - SA.loBoWoffset;
  } else {
    SAPC = (Math.pow(bgY, SA.revBG) - Math.pow(txtY, SA.revTXT)) * SA.scaleWoB;
    out = SAPC > -SA.loClip ? 0 : SAPC + SA.loWoBoffset;
  }
  return out * 100;
}
// Composite a translucent rgba over an opaque base
function compositeOver(top, base) {
  const a = top[3] ?? 1;
  return [
    Math.round(top[0]*a + base[0]*(1-a)),
    Math.round(top[1]*a + base[1]*(1-a)),
    Math.round(top[2]*a + base[2]*(1-a)),
    1,
  ];
}

// ─── Style block extraction ──────────────────────────────────────────────
function extractStyleBlocks(content, filepath) {
  const ext = extname(filepath);
  if (ext === '.css') return [{ kind: 'css', start: 1, body: content }];

  const blocks = [];
  // Astro <style> blocks
  for (const m of content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const startLine = content.slice(0, m.index).split('\n').length;
    blocks.push({ kind: 'css', start: startLine, body: m[1] });
  }
  // Inline style="..." attributes (CSS)
  for (const m of content.matchAll(/\sstyle="([^"]*)"/g)) {
    const startLine = content.slice(0, m.index).split('\n').length;
    blocks.push({ kind: 'inline-style', start: startLine, body: m[1] });
  }
  // JSX style={{ ... }} (TSX)
  if (ext === '.tsx' || ext === '.ts') {
    for (const m of content.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      const startLine = content.slice(0, m.index).split('\n').length;
      blocks.push({ kind: 'jsx-style', start: startLine, body: m[1] });
    }
  }
  // SVG color attributes (fill/stroke/stop-color/color="…")
  for (const m of content.matchAll(/\b(fill|stroke|stop-color|color)=("|')([^"']*)\2/g)) {
    const startLine = content.slice(0, m.index).split('\n').length;
    // Treat as a synthetic CSS line for downstream regex
    blocks.push({ kind: 'svg-attr', start: startLine, body: `${m[1]}: ${m[3]};`, attrName: m[1] });
  }
  return blocks;
}

// ─── Selector tracking ───────────────────────────────────────────────────
/* Track the open selector stack while scanning lines so each hit can be
 * tagged with its containing rule. Astro's <style> blocks are CSS-shaped
 * inside, so brace-counting works. */
function buildSelectorIndex(body, blockStartLine) {
  const lines = body.split('\n');
  const lineToSel = new Array(lines.length).fill(null);
  let stack = [];
  let pending = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (ch === '{') {
        const sel = pending.trim().replace(/\s+/g, ' ');
        if (sel) stack.push(sel);
        pending = '';
      } else if (ch === '}') {
        stack.pop();
        pending = '';
      } else if (ch === ';') {
        pending = '';
      } else {
        pending += ch;
      }
      j++;
    }
    lineToSel[i] = stack.slice();
  }
  return (idx) => lineToSel[idx] || [];
}

// ─── Patterns ────────────────────────────────────────────────────────────
const RE_TOKEN_DEF = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;\n}]+?)(?=[;\n}])/g;
const RE_TOKEN_USE = /var\((--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\)/g;
const RE_HEX = /(?<![\w-])(#[0-9a-fA-F]{3,8})(?![0-9a-fA-F])/g;
const RE_RGBA = /\brgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+)?\s*\)/g;
const RE_HSL = /\bhsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+)?\s*\)/g;

function isInsideVarFallback(line, idx) {
  const before = line.slice(0, idx);
  const opens = (before.match(/var\(/g) || []).length;
  const closes = (before.match(/\)/g) || []).length;
  return opens > closes;
}

// ─── Scan one file ───────────────────────────────────────────────────────
function scanFile(filepath, content) {
  const result = {
    file: relative(ROOT, filepath),
    defs: [],
    uses: [],
    hardcoded: [],
  };

  for (const block of extractStyleBlocks(content, filepath)) {
    const getSel = block.kind === 'css' ? buildSelectorIndex(block.body, block.start) : () => [];
    const lines = block.body.split('\n');

    lines.forEach((line, i) => {
      const lineNo = block.start + i;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      // Token definitions
      let m;
      const defRe = new RegExp(RE_TOKEN_DEF.source, 'g');
      while ((m = defRe.exec(line)) !== null) {
        result.defs.push({ name: m[1], value: m[2].trim(), line: lineNo, kind: block.kind });
      }

      // Token usages
      const useRe = new RegExp(RE_TOKEN_USE.source, 'g');
      while ((m = useRe.exec(line)) !== null) {
        result.uses.push({ name: m[1], fallback: m[2]?.trim() || null, line: lineNo, kind: block.kind });
      }

      // Hardcoded — for CSS blocks, require ":" assignment.
      // For inline-style/jsx-style/svg-attr, the body itself IS the assignment.
      const looksLikeValue = block.kind !== 'css' || /:/.test(line);
      if (!looksLikeValue) return;

      // Skip token DEFINITIONS — they're supposed to have hardcoded values
      // (--name: #color). Reporting them as 'replace with a token' is
      // wrong: the line IS the token. The downstream hardcoded scan is
      // about USAGES (color: #xxx etc), not definitions.
      if (/--[a-zA-Z0-9_-]+\s*:/.test(trimmed)) return;

      const sel = getSel(i);
      const ctx = trimmed.slice(0, 120);

      // Detect what CSS property this value is being assigned to
      // (color | background | border-color | stroke | fill | shadow | other).
      // Used downstream to prefer text-variant tokens for color: hits.
      const propMatch = trimmed.match(/^([a-z-]+)\s*:/);
      const property = propMatch ? propMatch[1].toLowerCase() :
                       block.kind === 'svg-attr' ? block.attrName : 'unknown';

      const hexRe = new RegExp(RE_HEX.source, 'g');
      while ((m = hexRe.exec(line)) !== null) {
        if (isInsideVarFallback(line, m.index)) continue;
        result.hardcoded.push({ kind: 'hex', value: m[1], line: lineNo, blockKind: block.kind, selector: sel.join(' › '), context: ctx, property });
      }
      const rgbaRe = new RegExp(RE_RGBA.source, 'g');
      while ((m = rgbaRe.exec(line)) !== null) {
        if (isInsideVarFallback(line, m.index)) continue;
        result.hardcoded.push({ kind: 'rgba', value: m[0], line: lineNo, blockKind: block.kind, selector: sel.join(' › '), context: ctx, property });
      }
      const hslRe = new RegExp(RE_HSL.source, 'g');
      while ((m = hslRe.exec(line)) !== null) {
        result.hardcoded.push({ kind: 'hsl', value: m[0], line: lineNo, blockKind: block.kind, selector: sel.join(' › '), context: ctx, property });
      }
    });
  }

  return result;
}

// ─── Aggregate + suggest ─────────────────────────────────────────────────
function aggregate(results, { threshold = 8 } = {}) {
  const tokenDefs = new Map();
  const tokenUses = new Map();
  const hardcoded = [];
  let totalDefs = 0;
  let totalUses = 0;

  for (const r of results) {
    for (const d of r.defs) {
      if (!tokenDefs.has(d.name)) tokenDefs.set(d.name, []);
      tokenDefs.get(d.name).push({ file: r.file, line: d.line, value: d.value, kind: d.kind });
      totalDefs++;
    }
    for (const u of r.uses) {
      if (!tokenUses.has(u.name)) tokenUses.set(u.name, []);
      tokenUses.get(u.name).push({ file: r.file, line: u.line, fallback: u.fallback, kind: u.kind });
      totalUses++;
    }
    for (const h of r.hardcoded) hardcoded.push({ file: r.file, ...h });
  }

  // Build a token color index for suggestions (only color-shaped tokens with parseable values)
  const colorTokens = [];
  for (const [name, defs] of tokenDefs) {
    for (const d of defs) {
      const c = parseColor(d.value);
      if (c) colorTokens.push({ name, value: d.value, rgba: c, lab: rgbToLab(c.slice(0,3)) });
    }
  }
  // Dedupe by name+value
  const seen = new Set();
  const colorTokensU = colorTokens.filter(t => {
    const k = `${t.name}=${t.value}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Property-aware token preference. Tokens are scored not just by color
  // distance but also by semantic fit:
  //   - color:   prefer --*-text > --ink* > anything else
  //   - border-color/stroke/fill: prefer non-text variants
  //   - background: prefer --surface-* / --bg* over solid color tokens
  // This keeps `color: #f0c866` from suggesting --promo when --promo-text exists.
  function preferenceBonus(tokenName, property) {
    const t = tokenName.toLowerCase();
    if (property === 'color' || property === 'fill') {
      if (t.endsWith('-text')) return -1.5;
      if (t.startsWith('--ink')) return -1.0;
      if (t.endsWith('-dim')) return -0.5;
      if (t.includes('-border') || t.includes('-glow')) return +2.0; // demote
    }
    if (property === 'background' || property === 'background-color') {
      if (t.startsWith('--surface') || t.startsWith('--bg')) return -1.0;
      if (t.startsWith('--shadow')) return +2.0;
    }
    if (property === 'border-color' || property === 'border' || property === 'stroke') {
      if (t.includes('-border')) return -1.0;
      if (t.endsWith('-text') || t.endsWith('-dim')) return +1.5;
    }
    if (property === 'box-shadow') {
      if (t.startsWith('--shadow') || t.includes('-glow')) return -1.0;
    }
    return 0;
  }

  for (const h of hardcoded) {
    const c = parseColor(h.value);
    if (!c) { h.suggest = null; continue; }
    const lab = rgbToLab(c.slice(0,3));
    let best = { name: null, dE: Infinity, value: null };
    for (const t of colorTokensU) {
      const dE = deltaE(lab, t.lab);
      const alphaDelta = Math.abs((c[3] ?? 1) - (t.rgba[3] ?? 1));
      const pref = preferenceBonus(t.name, h.property);
      const score = dE + alphaDelta * 25 + pref;
      if (score < best.dE) best = { name: t.name, dE: score, value: t.value };
    }
    h.suggest = best.dE <= threshold ? best : null;
  }

  const orphans = [];
  const missing = [];
  for (const [name] of tokenDefs) if (!tokenUses.has(name)) orphans.push(name);
  for (const [name] of tokenUses) if (!tokenDefs.has(name)) missing.push(name);

  return { tokenDefs, tokenUses, hardcoded, orphans, missing, totalDefs, totalUses, colorTokens: colorTokensU };
}

// ─── Output formatters ───────────────────────────────────────────────────
function fmtSummary(agg) {
  const out = [];
  out.push(`# Style Audit — Soma Website\n`);
  out.push(`Generated: ${new Date().toISOString()}\n`);
  out.push(`- **${agg.tokenDefs.size}** unique tokens`);
  out.push(`- **${agg.totalUses}** total usages`);
  out.push(`- **${agg.hardcoded.length}** hardcoded color hits`);
  const suggested = agg.hardcoded.filter(h => h.suggest);
  out.push(`- **${suggested.length}** of those map to an existing token (Δ-E ≤ threshold)`);
  out.push(`- **${agg.orphans.length}** orphan tokens · **${agg.missing.length}** missing`);
  return out.join('\n');
}

function fmtTable(agg, { onlyHardcoded = true } = {}) {
  const out = [];
  out.push(`# Hardcoded color hits — apply-ready table\n`);
  const items = onlyHardcoded ? agg.hardcoded : [...agg.hardcoded];
  // Group by file
  const byFile = new Map();
  for (const h of items) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [file, hits] of sorted) {
    out.push(`\n## \`${file}\` (${hits.length})\n`);
    out.push(`| L | Selector | Source | Value | → Suggest |`);
    out.push(`|---|---|---|---|---|`);
    for (const h of hits) {
      const sel = h.selector ? '`' + h.selector.slice(0, 38) + (h.selector.length > 38 ? '…' : '') + '`' : '_(inline)_';
      const src = h.blockKind === 'css' ? 'css' : h.blockKind === 'svg-attr' ? 'svg' : h.blockKind === 'inline-style' ? 'style=' : 'jsx-style';
      const v = `\`${h.value}\``;
      // Token names already include their leading `--`, so var(NAME) not var(--NAME)
      const sug = h.suggest
        ? `\`var(${h.suggest.name})\` _(Δ ${h.suggest.dE.toFixed(1)})_`
        : '_no match_';
      out.push(`| ${h.line} | ${sel} | ${src} | ${v} | ${sug} |`);
    }
  }
  return out.join('\n');
}

function fmtExtract(agg) {
  const out = [];
  out.push('# Apply-ready extracts (hardcoded → suggested token)\n');
  out.push('Format: `file:line  current  →  replacement`\n');
  for (const h of agg.hardcoded) {
    if (!h.suggest) continue;
    const replacement = `var(${h.suggest.name})`;
    out.push(`\n### \`${h.file}:${h.line}\`  ·  Δ-E ${h.suggest.dE.toFixed(1)}`);
    if (h.selector) out.push(`Selector: \`${h.selector}\``);
    out.push('```diff');
    out.push(`- ${h.context}`);
    out.push(`+ ${h.context.replace(h.value, replacement)}`);
    out.push('```');
  }
  return out.join('\n');
}

function fmtComponent(agg, file) {
  const targetFile = file.replace(/^\.\//, '');
  const out = [];
  out.push(`# Component report: \`${targetFile}\`\n`);

  const defs = [];
  for (const [name, list] of agg.tokenDefs) {
    for (const d of list) if (d.file === targetFile) defs.push({ name, ...d });
  }
  const uses = [];
  for (const [name, list] of agg.tokenUses) {
    for (const u of list) if (u.file === targetFile) uses.push({ name, ...u });
  }
  const hits = agg.hardcoded.filter(h => h.file === targetFile);

  out.push(`- **${defs.length}** token definitions`);
  out.push(`- **${uses.length}** token usages`);
  out.push(`- **${hits.length}** hardcoded color hits\n`);

  if (defs.length) {
    out.push(`## Defines tokens`);
    for (const d of defs) out.push(`- L${d.line}: \`${d.name}: ${d.value}\``);
  }

  if (hits.length) {
    out.push(`\n## Hardcoded`);
    out.push(`| L | Selector | Source | Value | → Suggest |`);
    out.push(`|---|---|---|---|---|`);
    for (const h of hits) {
      const sel = h.selector ? '`' + h.selector.slice(0, 50) + '`' : '_(inline)_';
      const sug = h.suggest ? `\`var(${h.suggest.name})\` (Δ ${h.suggest.dE.toFixed(1)})` : '_—_';
      out.push(`| ${h.line} | ${sel} | ${h.blockKind} | \`${h.value}\` | ${sug} |`);
    }
  }

  if (uses.length) {
    out.push(`\n## Uses tokens (${uses.length})`);
    const counts = new Map();
    for (const u of uses) counts.set(u.name, (counts.get(u.name) || 0) + 1);
    for (const [name, n] of [...counts.entries()].sort((a,b) => b[1] - a[1])) {
      out.push(`- \`${name}\` × ${n}`);
    }
  }

  return out.join('\n');
}

function fmtContrast(agg, surface) {
  // Build resolved-color map: token → [r,g,b,a] for given surface
  const resolved = new Map();
  for (const [name, defs] of agg.tokenDefs) {
    let pick = null;
    for (const d of defs) {
      // Prefer explicit surface match if present
      if (surface === 'light' && /surface="light"|data-surface='light'|data-surface="light"/.test(d.value || '')) pick = d;
    }
    // Fallback to first def
    if (!pick) pick = defs[0];
    const c = parseColor(pick.value);
    if (c) resolved.set(name, c);
  }

  // Heuristic typical bg per surface
  const baseBg = surface === 'dark' ? [12, 15, 22, 1] : [232, 238, 245, 1];

  // Foreground tokens (text-likely): names containing ink, text, promo-text, accent
  const fgNames = [...resolved.keys()].filter(n =>
    /^(--ink|--text|--promo-text|--promo-dim|--accent|--moon-bright|--brand-sigma|--sun-text|--warm-mid|--warm-bright|--promo)$/.test(n));
  // Background tokens (likely surfaces)
  const bgNames = [...resolved.keys()].filter(n =>
    /^(--bg|--bg-card|--bg-elev|--surface-card|--surface-card-strong|--surface-interactive|--surface-accent-soft|--surface-warm-soft)$/.test(n));

  const out = [];
  out.push(`# Contrast matrix (surface=${surface})\n`);
  out.push('Pairs below WCAG AA (4.5:1 for body text, 3:1 for large text) are flagged.');
  out.push('Translucent backgrounds composited over the page bg before scoring.\n');
  out.push(`| FG \\ BG | ${bgNames.join(' | ')} |`);
  out.push(`|${'---|'.repeat(bgNames.length + 1)}`);
  for (const fg of fgNames) {
    const fgRgb = resolved.get(fg);
    if (!fgRgb) continue;
    const cells = bgNames.map(bg => {
      const bgRaw = resolved.get(bg);
      if (!bgRaw) return '_-_';
      const bgEff = compositeOver(bgRaw, baseBg);
      const fgRgb3 = fgRgb.slice(0,3);
      const bgRgb3 = bgEff.slice(0,3);
      const r = contrastRatio(fgRgb3, bgRgb3);
      const lc = Math.abs(apcaContrast(fgRgb3, bgRgb3));
      // Combined verdict: PASS if both meet threshold
      const wcagPass = r >= 4.5;
      const apcaPass = lc >= 75;
      const flag = wcagPass && apcaPass ? ' ✅' :
                   wcagPass || apcaPass ? ' 🟡' :
                   r < 3 || lc < 45     ? ' 🔴' : ' 🟡';
      return `${r.toFixed(1)} / Lc${lc.toFixed(0)}${flag}`;
    });
    out.push(`| \`${fg}\` | ${cells.join(' | ')} |`);
  }
  out.push('\nFormat: `WCAG / Lc<APCA>`');
  out.push('Legend: ✅ both pass (WCAG ≥4.5, APCA |Lc|≥75)');
  out.push('  •  🟡 only one passes (large text/heading might be ok)');
  out.push('  •  🔴 both fail (WCAG <3 OR APCA |Lc|<45)');
  out.push('\nWCAG 2.1: 4.5:1 body, 3:1 large. APCA (W3 draft): ≥75 body, ≥60 heading, ≥45 large.');
  return out.join('\n');
}

function fmtSuggest(agg) {
  const matched = agg.hardcoded.filter(h => h.suggest).sort((a,b) => a.suggest.dE - b.suggest.dE);
  const out = [];
  out.push(`# Suggested replacements (Δ-E sorted, lowest = best match)\n`);
  out.push(`| File | L | Selector | Hardcoded | → Suggest | Δ-E |`);
  out.push(`|---|---|---|---|---|---|`);
  for (const h of matched) {
    const sel = h.selector ? '`' + h.selector.slice(0,32) + '`' : '_inline_';
    out.push(`| \`${h.file}\` | ${h.line} | ${sel} | \`${h.value}\` | \`var(${h.suggest.name})\` | ${h.suggest.dE.toFixed(2)} |`);
  }
  out.push(`\n_${matched.length} of ${agg.hardcoded.length} hardcoded values have a token match within threshold._`);
  return out.join('\n');
}

function applyRewrites(agg, { dryRun = true }) {
  const matched = agg.hardcoded.filter(h => h.suggest);
  const byFile = new Map();
  for (const h of matched) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }

  const results = [];
  for (const [file, hits] of byFile) {
    const fullPath = join(ROOT, file);
    let content = readFileSync(fullPath, 'utf8');
    let newContent = content;
    let rewrites = 0;

    // Sort hits by line desc so replacements don't shift earlier lines
    hits.sort((a, b) => b.line - a.line);

    for (const h of hits) {
      const lines = newContent.split('\n');
      const i = h.line - 1;
      if (i < 0 || i >= lines.length) continue;
      const before = lines[i];
      const replacement = `var(${h.suggest.name})`;
      const after = before.replace(h.value, replacement);
      if (after !== before) {
        lines[i] = after;
        newContent = lines.join('\n');
        rewrites++;
      }
    }

    if (rewrites > 0) {
      results.push({ file, rewrites, applied: !dryRun });
      if (!dryRun) {
        writeFileSync(fullPath + '.bak', content);
        writeFileSync(fullPath, newContent);
      }
    }
  }

  return results;
}

// ─── Other formatters (re-exported from previous version) ────────────────
function fmtToken(agg, name) {
  const out = [];
  out.push(`# Token trace: \`${name}\`\n`);
  const defs = agg.tokenDefs.get(name) || [];
  const uses = agg.tokenUses.get(name) || [];
  out.push(`## Defined in ${defs.length} place(s)\n`);
  for (const d of defs) out.push(`- \`${d.file}:${d.line}\` → \`${d.value}\``);
  out.push(`\n## Used in ${uses.length} place(s)\n`);
  const byFile = new Map();
  for (const u of uses) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }
  for (const [file, list] of byFile) {
    out.push(`### \`${file}\` (${list.length})`);
    for (const u of list) out.push(`- L${u.line}${u.fallback ? ` (fallback: \`${u.fallback}\`)` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const argv = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  const skipGenerated = has('--skip-generated');
  const threshold = +(argv('--threshold') || 8);
  const files = walk(SRC, undefined, { skipGenerated });
  const results = files.map(f => scanFile(f, readFileSync(f, 'utf8')));
  const agg = aggregate(results, { threshold });

  if (has('--json')) { console.log(JSON.stringify({ agg }, (k, v) => v instanceof Map ? Object.fromEntries(v) : v, 2)); return; }
  if (has('--token')) { const n = argv('--token'); console.log(fmtToken(agg, n.startsWith('--') ? n : `--${n}`)); return; }
  if (has('--orphans')) { for (const n of agg.orphans) console.log(`${n}  ${(agg.tokenDefs.get(n)||[]).map(d=>`${d.file}:${d.line}`).join(', ')}`); return; }
  if (has('--missing')) {
    for (const n of agg.missing) {
      const u = agg.tokenUses.get(n);
      console.log(`${n} (${u.length}x) — first: ${u[0].file}:${u[0].line}`);
    }
    return;
  }
  if (has('--component')) {
    const f = argv('--component') || args[args.indexOf('--component')+1];
    if (!f) { console.error('--component <file> required'); process.exit(2); }
    console.log(fmtComponent(agg, f));
    return;
  }
  if (has('--extract')) { console.log(fmtExtract(agg)); return; }
  if (has('--suggest')) { console.log(fmtSuggest(agg)); return; }
  if (has('--contrast')) {
    const s = argv('--contrast') || 'light';
    console.log(fmtContrast(agg, s));
    return;
  }
  if (has('--table')) { console.log(fmtTable(agg)); return; }
  if (has('--apply')) {
    const dry = has('--dry-run');
    const r = applyRewrites(agg, { dryRun: dry });
    console.log(`# Apply${dry ? ' (DRY-RUN)' : ''}\n`);
    let total = 0;
    for (const x of r) { console.log(`- ${x.file}: ${x.rewrites} rewrite(s)${dry ? '' : ' [applied, .bak written]'}`); total += x.rewrites; }
    console.log(`\nTotal: ${total} rewrites across ${r.length} files`);
    return;
  }
  if (has('--hardcoded')) {
    const byFile = new Map();
    for (const h of agg.hardcoded) {
      if (!byFile.has(h.file)) byFile.set(h.file, []);
      byFile.get(h.file).push(h);
    }
    for (const [file, hits] of [...byFile.entries()].sort((a,b)=>b[1].length-a[1].length)) {
      console.log(`## ${file} (${hits.length})`);
      for (const h of hits) console.log(`  L${h.line}: ${h.value}  ←  ${h.context}`);
      console.log('');
    }
    return;
  }
  // Default
  console.log(fmtSummary(agg));
  console.log('\n');
  console.log(fmtTable(agg));
}

main();
