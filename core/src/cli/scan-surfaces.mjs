#!/usr/bin/env node
/**
 * Tincture v0.2 — surface scanner.
 *
 * Walks JSX/TSX files looking for elements that have a hardcoded surface
 * (bg-white, bg-black, dark-token bg, image+overlay, etc.) but no
 * explicit `data-surface=` annotation. Without the annotation, the
 * subtree's --ink/--bg/--accent inherit from the closest ancestor that
 * declares data-surface, which produces invisible-text bugs when the
 * site's html-level surface flips (light/dark theme toggle).
 *
 * Detection categories:
 *   1. <section> / <div> / <aside> / <nav> / <header> with class
 *      containing one of:
 *        - bg-black (no /N opacity)              → likely dark surface
 *        - bg-[#0xx], bg-[#10x..12x]             → dark surface
 *        - bg-[var(--bg-dark*)] or *-charcoal    → dark surface
 *        - bg-[var(--color-bg-accent-band)]      → dark surface (legacy)
 *        - bg-white (no /N)                      → light surface
 *        - bg-[#fff], bg-[#FFF]                  → light surface
 *        - bg-[var(--bg-card)] inside dark page  → light surface (heuristic)
 *
 *   2. <section> / <div> with <Image fill> or <img absolute inset-0>
 *      AND a darken overlay (bg-black/N, from-black/N gradient)
 *      → dark surface (image-overlay hero pattern)
 *
 * Modes:
 *   --check    exit non-zero with report if any annotations missing
 *   --report   print a markdown report (no exit code change)
 *   --fix      auto-inject data-surface="dark|light" where unambiguous
 *              (only fixes <section>; manual review for <div>/<aside>/
 *              <nav>/<header> because those often have ambiguous intent)
 *
 * Run:
 *   node src/cli/scan-surfaces.mjs --root <repo-or-app-path>
 *   node src/cli/scan-surfaces.mjs --root <path> --check     (CI)
 *   node src/cli/scan-surfaces.mjs --root <path> --report
 *   node src/cli/scan-surfaces.mjs --root <path> --fix
 *
 * See docs/architecture/why-not-automatic.md for the full reasoning.
 *
 * Cycle 25 (extended).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = resolve(arg('--root', process.cwd()));
const MODE = process.argv.includes('--fix') ? 'fix'
           : process.argv.includes('--check') ? 'check'
           : 'report';

// ── pattern dictionaries ──────────────────────────────────────────────

const DARK_BG_PATTERNS = [
  { re: /\bbg-black(?!\/\d)/, why: 'bg-black' },
  { re: /\bbg-\[#0[0-9a-f]/i, why: 'bg-[#0xx]' },
  { re: /\bbg-\[#1[0-2][0-9a-f]/i, why: 'bg-[#1[0-2]xx]' },
  { re: /\bbg-\[var\(--bg-dark\)\]/, why: 'var(--bg-dark)' },
  { re: /\bbg-\[var\(--bg-charcoal\)\]/, why: 'var(--bg-charcoal)' },
  { re: /\bbg-\[var\(--color-bg-accent-band\)\]/, why: 'var(--color-bg-accent-band)' },
];

const LIGHT_BG_PATTERNS = [
  { re: /\bbg-white(?!\/\d)/, why: 'bg-white' },
  { re: /\bbg-\[#[fF][fF][fF]\]/, why: 'bg-[#fff]' },
];

// ── element matcher ───────────────────────────────────────────────────
// Only flag SEMANTIC LANDMARK elements (section, aside, nav, header, main,
// article, footer). Nested <div> wrappers inherit correctly from the
// closest landmark; flagging them is noise. The exception is <div> with
// hardcoded bg-white (typical for menu panels / cards rendered without a
// section wrapper).
const LANDMARK_RE = /<(section|aside|nav|header|article|main|footer)\b([^>]*?)>/g;
const LIGHT_DIV_RE = /<(div)\b([^>]*?)>/g;

// ── walk + analyze ────────────────────────────────────────────────────

function listFiles() {
  const out = execSync(
    `find "${ROOT}" \\
      -type d \\( -name node_modules -o -name .next -o -name _generated -o -name .worktrees -o -name dist -o -name build -o -name .git \\) -prune -o \\
      -type f \\( -name '*.tsx' -o -name '*.ts' \\) -print`,
    { encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean);
  return out;
}

function classNameFromAttrs(attrs) {
  const m = attrs.match(/\bclassName=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function hasDarkBg(cls) {
  for (const p of DARK_BG_PATTERNS) if (p.re.test(cls)) return p.why;
  return null;
}

function hasLightBg(cls) {
  for (const p of LIGHT_BG_PATTERNS) if (p.re.test(cls)) return p.why;
  return null;
}

function hasImageOverlay(blockAfterOpen) {
  const hasFillImage = /<Image\s[^>]*\bfill\b|<img\s[^>]*absolute\s+inset-0|<video\s[^>]*absolute\s+inset-0/.test(blockAfterOpen);
  const hasDarkenOverlay = /bg-black\/\d|from-black\/\d|to-black\/\d|via-black\/\d/.test(blockAfterOpen);
  return hasFillImage && hasDarkenOverlay;
}

const findings = []; // { file, line, tag, surface, why, matched }

for (const f of listFiles()) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  
  // Pass 1: landmark elements
  let m;
  LANDMARK_RE.lastIndex = 0;
  while ((m = LANDMARK_RE.exec(content)) !== null) {
    const [full, tag, attrs] = m;
    if (full.includes('data-surface=')) continue;
    
    const cls = classNameFromAttrs(attrs);
    const bodyAfter = content.slice(m.index + full.length, m.index + full.length + 2500);
    
    const darkWhy = hasDarkBg(cls);
    const lightWhy = hasLightBg(cls);
    const overlayMatch = hasImageOverlay(full + bodyAfter);
    
    if (!darkWhy && !lightWhy && !overlayMatch) continue;
    
    const lineNum = content.slice(0, m.index).split('\n').length;
    let surface = 'unknown';
    let why = '';
    
    if (overlayMatch) { surface = 'dark'; why = 'image+overlay'; }
    else if (darkWhy) { surface = 'dark'; why = darkWhy; }
    else if (lightWhy) { surface = 'light'; why = lightWhy; }
    
    findings.push({
      file: relative(ROOT, f),
      line: lineNum,
      tag,
      surface,
      why,
      autoFixable: tag === 'section',
    });
  }

  // Pass 2: <div> with hardcoded bg-white (light card / panel pattern)
  // OR bg-black with content that includes text utilities. These are the
  // 'menu panel' / 'modal' patterns where surface affects descendants'
  // ink color but the element isn't a semantic landmark.
  LIGHT_DIV_RE.lastIndex = 0;
  while ((m = LIGHT_DIV_RE.exec(content)) !== null) {
    const [full, tag, attrs] = m;
    if (full.includes('data-surface=')) continue;
    
    const cls = classNameFromAttrs(attrs);
    const bodyAfter = content.slice(m.index + full.length, m.index + full.length + 2500);
    
    // For divs, only flag explicit bg-white / bg-black (no opacity) AND
    // descendant uses text-[var(--ink) tokens (likely a content panel).
    const darkWhy = hasDarkBg(cls);
    const lightWhy = hasLightBg(cls);
    if (!darkWhy && !lightWhy) continue;
    
    const usesInkTokens = /text-\[var\(--ink|text-\[var\(--ink-/.test(bodyAfter);
    if (!usesInkTokens) continue;
    
    const lineNum = content.slice(0, m.index).split('\n').length;
    let surface = darkWhy ? 'dark' : 'light';
    let why = darkWhy || lightWhy;
    
    findings.push({
      file: relative(ROOT, f),
      line: lineNum,
      tag: 'div',
      surface,
      why,
      autoFixable: false,  // div semantics are ambiguous; manual review
    });
  }
}

// ── output ────────────────────────────────────────────────────────────

if (MODE === 'fix') {
  // group by file; mutate
  const byFile = {};
  for (const f of findings) {
    if (!f.autoFixable) continue;
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  }
  let fixedCount = 0;
  const fixedFiles = [];
  for (const [file, list] of Object.entries(byFile)) {
    const path = resolve(ROOT, file);
    let content = readFileSync(path, 'utf8');
    // For each finding, find the opening tag at that line and inject data-surface
    // Process in reverse so line numbers don't shift
    list.sort((a, b) => b.line - a.line);
    for (const f of list) {
      const lines = content.split('\n');
      const idx = f.line - 1;
      // The tag may span multiple lines; replace first <tag\b on the line
      const re = new RegExp(`<${f.tag}\\b(?!.*data-surface)`);
      if (re.test(lines[idx])) {
        lines[idx] = lines[idx].replace(re, `<${f.tag} data-surface="${f.surface}"`);
        content = lines.join('\n');
        fixedCount++;
      }
    }
    if (list.length > 0) {
      writeFileSync(path, content);
      fixedFiles.push(file);
    }
  }
  console.log(`Fixed ${fixedCount} elements across ${fixedFiles.length} files.`);
  for (const f of fixedFiles) console.log(`  - ${f}`);
  process.exit(0);
}

if (MODE === 'check' || MODE === 'report') {
  const dark = findings.filter(f => f.surface === 'dark');
  const light = findings.filter(f => f.surface === 'light');
  
  console.log(`# Surface annotation scan — ${ROOT}\n`);
  console.log(`Total findings: ${findings.length}`);
  console.log(`  dark surfaces missing data-surface=dark:   ${dark.length}`);
  console.log(`  light surfaces missing data-surface=light: ${light.length}`);
  console.log(`  auto-fixable (--fix):                       ${findings.filter(f => f.autoFixable).length}\n`);
  
  if (dark.length > 0) {
    console.log(`## DARK surfaces missing annotation`);
    for (const f of dark) {
      console.log(`  ${f.file}:${f.line}  <${f.tag}>  ${f.why}${f.autoFixable ? '  [auto-fixable]' : ''}`);
    }
    console.log('');
  }
  if (light.length > 0) {
    console.log(`## LIGHT surfaces missing annotation`);
    for (const f of light) {
      console.log(`  ${f.file}:${f.line}  <${f.tag}>  ${f.why}${f.autoFixable ? '  [auto-fixable]' : ''}`);
    }
  }
  
  if (MODE === 'check' && findings.length > 0) process.exit(1);
}

process.exit(0);
