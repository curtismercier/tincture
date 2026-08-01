#!/usr/bin/env node
/**
 * apply-typography.mjs — auto-migrate hard-coded heading typography
 * to Tincture tokens.
 *
 * Safe scope: ONLY lines containing an opening <h1/h2/h3/h4 tag.
 * Body text (<p>, <span>, <div>, <button>) is never touched.
 *
 * Modes:
 *   --dry     Print changes without writing (default if no flag)
 *   --apply   Write changes to disk
 *   --check   Exit 1 if any changes would be made (CI gate)
 *   --file <path>  Limit to one file (relative to repo root)
 *
 * What it does on heading lines:
 *
 *  1. Collapse responsive size ladder → single fluid token:
 *       text-4xl md:text-6xl lg:text-7xl  → --type-display-1  (h1)
 *       text-4xl md:text-6xl              → --type-display-1
 *       text-5xl md:text-6xl+             → --type-display-1
 *       text-4xl md:text-5xl              → --type-display-2
 *       text-3xl md:text-5xl              → --type-display-2
 *       text-5xl (standalone)             → --type-display-2
 *       text-3xl md:text-4xl              → --type-display-3
 *       text-4xl (standalone)             → --type-display-3
 *       text-3xl (standalone)             → --type-display-3
 *       text-2xl (standalone)             → --type-display-3
 *       text-xl (standalone)              → --type-body-1
 *       text-lg (standalone)              → --type-body-1
 *
 *  2. Font weight:
 *       font-bold / font-extrabold / font-black / font-semibold on <h1>  → font-[var(--weight-display)]
 *       same on <h2/h3/h4>                                                → font-[var(--weight-heading)]
 *
 *  3. Tracking (only definitive heading tracking — NOT tracking-wide/wider):
 *       tracking-tight / tracking-tighter → tracking-[var(--track-display)]
 *
 *  4. Leading:
 *       leading-tight         → leading-[var(--leading-tight)]
 *       leading-[1.0]         → leading-[var(--leading-tight)]
 *       leading-[1.05]        → leading-[var(--leading-tight)]
 *       leading-[1.1]         → leading-[var(--leading-tight)]
 *       leading-relaxed       → leading-[var(--leading-relaxed)]
 *       leading-[1.5–1.8]     → leading-[var(--leading-relaxed)]
 *
 *  5. Font family: adds [font-family:var(--font-display)] to heading lines
 *     that don't already have it and don't have font-serif (those are accent spans).
 *
 * Does NOT touch:
 *   - Lines already containing var(--type- or var(--weight- (already migrated)
 *   - tracking-wide / tracking-wider / tracking-widest (different intent)
 *   - Closing tags </h1> etc.
 *   - Any non-heading tag line
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DRY   = !process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const fileArg = (() => { const i = process.argv.indexOf('--file'); return i >= 0 ? process.argv[i+1] : null; })();

// ── file walker ────────────────────────────────────────────────────────────
function walk(dir, exts = ['.tsx'], skip = ['node_modules', '.next', '.git', 'dist', '_generated', '_archive']) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some(e => p.endsWith(e))) out.push(p);
  }
  return out;
}

const TARGETS = fileArg
  ? [resolve(ROOT, fileArg)]
  : [
      ...walk(resolve(ROOT, 'src/tenants/arzadon/components')),
      ...walk(resolve(ROOT, 'src/app/(tenants)/sites/arzadon')),
    ];

// ── already-migrated guard ─────────────────────────────────────────────────
const ALREADY = /var\(--type-|var\(--weight-|var\(--track-display|var\(--leading-|var\(--font-display\)/;

// ── heading-context detector ───────────────────────────────────────────────
// Matches opening h1/h2/h3/h4 tags (not closing </h*>)
const H_TAG = /^[^<]*<(h([1-4]))\b[^/]*(?:className|class)=/;

// ── size collapse rules (order matters — most specific first) ──────────────
// Each entry: [regex to remove, replacement token]
// The regex matches the full multi-breakpoint ladder as a substring of className
const SIZE_COLLAPSES = [
  // h1-level — must come before h2-level patterns (most specific first)
  [/text-4xl +(?:sm|md|lg|xl):text-6xl +(?:sm|md|lg|xl):text-7xl/, 'text-[length:var(--type-display-1)]'],
  [/text-4xl +(?:sm|md|lg|xl):text-6xl +(?:sm|md|lg|xl):text-8xl/, 'text-[length:var(--type-display-1)]'],
  [/text-5xl +(?:sm|md|lg|xl):text-7xl/,                            'text-[length:var(--type-display-1)]'],
  [/text-5xl +(?:sm|md|lg|xl):text-8xl/,                            'text-[length:var(--type-display-1)]'],
  [/text-6xl +(?:sm|md|lg|xl):text-8xl/,                            'text-[length:var(--type-display-1)]'],
  [/text-6xl +(?:sm|md|lg|xl):text-7xl/,                            'text-[length:var(--type-display-1)]'],
  [/text-4xl +(?:sm|md|lg|xl):text-7xl/,                            'text-[length:var(--type-display-1)]'],
  [/text-4xl +(?:sm|md|lg|xl):text-6xl/,                            'text-[length:var(--type-display-1)]'],
  // display-2 (section headline) — 3-breakpoint before 2-breakpoint
  [/text-3xl +(?:sm|md|lg|xl):text-4xl +(?:sm|md|lg|xl):text-6xl/,  'text-[length:var(--type-display-2)]'],
  [/text-3xl +(?:sm|md|lg|xl):text-4xl +(?:sm|md|lg|xl):text-5xl/,  'text-[length:var(--type-display-2)]'],
  [/text-4xl +(?:sm|md|lg|xl):text-5xl +(?:sm|md|lg|xl):text-6xl/,  'text-[length:var(--type-display-2)]'],
  [/text-4xl +(?:sm|md|lg|xl):text-5xl/,                             'text-[length:var(--type-display-2)]'],
  [/text-3xl +(?:sm|md|lg|xl):text-5xl +(?:sm|md|lg|xl):text-6xl/,  'text-[length:var(--type-display-2)]'],
  [/text-3xl +(?:sm|md|lg|xl):text-5xl/,                             'text-[length:var(--type-display-2)]'],
  [/text-5xl +(?:sm|md|lg|xl):text-6xl/,                             'text-[length:var(--type-display-2)]'],
  // display-3 (sub-section) — 3-breakpoint before 2-breakpoint
  [/text-xl +(?:sm|md|lg|xl):text-2xl +(?:sm|md|lg|xl):text-3xl/,   'text-[length:var(--type-display-3)]'],
  [/text-xl +(?:sm|md|lg|xl):text-3xl/,                              'text-[length:var(--type-display-3)]'],
  [/text-xl +(?:sm|md|lg|xl):text-2xl/,                              'text-[length:var(--type-display-3)]'],
  [/text-lg +(?:sm|md|lg|xl):text-xl/,                               'text-[length:var(--type-body-1)]'],
  [/text-2xl +(?:sm|md|lg|xl):text-4xl/,                             'text-[length:var(--type-display-3)]'],
  [/text-2xl +(?:sm|md|lg|xl):text-3xl/,                             'text-[length:var(--type-display-3)]'],
  [/text-3xl +(?:sm|md|lg|xl):text-4xl/,                             'text-[length:var(--type-display-3)]'],
  // Standalone sizes (no breakpoint variant) — order: largest first
  [/\btext-7xl\b/, 'text-[length:var(--type-display-1)]'],
  [/\btext-6xl\b/, 'text-[length:var(--type-display-1)]'],
  [/\btext-5xl\b/, 'text-[length:var(--type-display-2)]'],
  [/\btext-4xl\b/, 'text-[length:var(--type-display-3)]'],
  [/\btext-3xl\b/, 'text-[length:var(--type-display-3)]'],
  [/\btext-2xl\b/, 'text-[length:var(--type-display-3)]'],
  [/\btext-xl\b/,  'text-[length:var(--type-body-1)]'],
  [/\btext-lg\b/,  'text-[length:var(--type-body-1)]'],
];

const WEIGHT_DISPLAY  = 'font-[var(--weight-display)]';
const WEIGHT_HEADING  = 'font-[var(--weight-heading)]';
const WEIGHT_RE = /\b(font-bold|font-extrabold|font-black|font-semibold)\b/g;

const TRACKING_TIGHT_RE = /\b(tracking-tight|tracking-tighter)\b/g;
const TRACKING_TOKEN    = 'tracking-[var(--track-display)]';

const LEADING_TIGHT_RE = /\b(leading-tight|leading-\[1\.[01][05]?\]|leading-\[1\.0\])\b/g;
const LEADING_TIGHT_TOKEN = 'leading-[var(--leading-tight)]';

const LEADING_RELAXED_RE = /\b(leading-relaxed|leading-\[1\.[5-9]\])\b/g;
const LEADING_RELAXED_TOKEN = 'leading-[var(--leading-relaxed)]';

const FONT_FAMILY_TOKEN = '[font-family:var(--font-display)]';

// ── transform one line ─────────────────────────────────────────────────────
function transformLine(line) {
  if (ALREADY.test(line)) return line;                      // already migrated
  const match = H_TAG.exec(line);
  if (!match) return line;                                   // not a heading tag

  const level = parseInt(match[2]);                          // 1, 2, 3, or 4
  const weightToken = level === 1 ? WEIGHT_DISPLAY : WEIGHT_HEADING;

  let out = line;

  // 1. Collapse size ladder (apply first, most-specific first)
  for (const [pattern, token] of SIZE_COLLAPSES) {
    const before = out;
    out = out.replace(pattern, token);
    if (out !== before) break; // only apply one size rule per line
  }

  // 2. Weight
  out = out.replace(WEIGHT_RE, weightToken);

  // 3. Tracking (only tight, not wide)
  out = out.replace(TRACKING_TIGHT_RE, TRACKING_TOKEN);

  // 4. Leading
  out = out.replace(LEADING_TIGHT_RE, LEADING_TIGHT_TOKEN);
  out = out.replace(LEADING_RELAXED_RE, LEADING_RELAXED_TOKEN);

  // 5. Add font-family token if not present and line doesn't use font-serif
  if (!out.includes(FONT_FAMILY_TOKEN) && !out.includes('font-serif')) {
    // Insert before the closing quote of className="..."
    out = out.replace(/(className="[^"]+)(")/, `$1 ${FONT_FAMILY_TOKEN}$2`);
  }

  return out;
}

// ── process files ──────────────────────────────────────────────────────────
let totalFiles = 0, totalLines = 0;
const report = [];

for (const absPath of TARGETS) {
  const relPath = relative(ROOT, absPath);
  const src = readFileSync(absPath, 'utf8');
  const lines = src.split('\n');

  const changed = [];
  const newLines = lines.map((line, i) => {
    const after = transformLine(line);
    if (after !== line) {
      changed.push({ line: i + 1, before: line.trim(), after: after.trim() });
    }
    return after;
  });

  if (changed.length === 0) continue;

  totalFiles++;
  totalLines += changed.length;
  report.push({ file: relPath, changed });

  if (!DRY) {
    writeFileSync(absPath, newLines.join('\n'), 'utf8');
  }
}

// ── output ─────────────────────────────────────────────────────────────────
if (report.length === 0) {
  console.log('✓ Nothing to migrate. All heading typography is token-driven.');
  process.exit(0);
}

if (DRY || CHECK) {
  for (const { file, changed } of report) {
    console.log(`\n── ${file} (${changed.length} lines)`);
    for (const { line, before, after } of changed) {
      console.log(`  L${line} before: ${before.slice(0, 120)}`);
      console.log(`       after:  ${after.slice(0, 120)}`);
    }
  }
  console.log(`\n── ${DRY ? 'Dry run' : 'Check'}: ${totalLines} lines in ${totalFiles} files would change.`);
  console.log(DRY ? '  Run with --apply to write.' : '');
}

if (!DRY) {
  console.log(`✓ Applied ${totalLines} changes across ${totalFiles} files.`);
}

if (CHECK && totalLines > 0) process.exit(1);
