#!/usr/bin/env node
/**
 * scan-tailwind.mjs — smart scanner for hardcoded CSS values.
 *
 * Authored s01-91da41. Curtis: "find anything and everything that should be
 * tokenized -- have the script pull out the component and/or container so
 * you can see what it is -- which page -- make it a smart script helper
 * like code:map -- something you can see ok this is a button on this page,
 * w/ dark background."
 *
 * Strategy:
 *   1. Walk src/tenants/arzadon/ + src/app/(tenants)/sites/arzadon/
 *   2. For each .tsx, scan for "should be tokenized" patterns
 *   3. For each match, walk UP the file to find the nearest opening JSX tag.
 *      Extract: element type, className, any text children (the button label).
 *   4. Classify by pattern type (B0/B1/B2 etc.)
 *   5. Emit markdown grouped by file+page route.
 *
 * Usage:
 *   node scripts/scan-tailwind.mjs                       # full markdown report → stdout
 *   node scripts/scan-tailwind.mjs --md > report.md      # save to file
 *   node scripts/scan-tailwind.mjs --limit 20            # first N findings
 *   node scripts/scan-tailwind.mjs --file <path>         # one file only
 *   node scripts/scan-tailwind.mjs --pattern color       # only color-related (default)
 *   node scripts/scan-tailwind.mjs --pattern hardcoded-hex # only #XXXXXX literals
 *   node scripts/scan-tailwind.mjs --pattern keyword     # only text-white/black, bg-white/black
 *   node scripts/scan-tailwind.mjs --pattern tailwind    # only bg-zinc-/slate-/gray-/etc.
 *   node scripts/scan-tailwind.mjs --pattern inline      # only inline style={{...}}
 *   node scripts/scan-tailwind.mjs --severity p0         # only Critical (B1 contrast bugs)
 *   node scripts/scan-tailwind.mjs --json                # machine-readable findings
 *
 * Exit code 0 always. This is a reporter, not a gate.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Walk ───────────────────────────────────────────────────────────────
function walk(dir, exts = ['.tsx'], skip = ['node_modules', '.next', '.git', 'dist', '__tests__']) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// ─── Pattern catalog ────────────────────────────────────────────────────
const PATTERNS = {
  'hardcoded-hex-bg':   { re: /bg-\[#[0-9a-fA-F]{3,8}\]/g,        category: 'color',     severity: 'P1', label: 'hardcoded-hex bg' },
  'hardcoded-hex-text': { re: /text-\[#[0-9a-fA-F]{3,8}\]/g,      category: 'color',     severity: 'P1', label: 'hardcoded-hex text' },
  'hardcoded-hex-border': { re: /border-\[#[0-9a-fA-F]{3,8}\]/g,  category: 'color',     severity: 'P2', label: 'hardcoded-hex border' },
  'gradient-hex':       { re: /(?:from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g, category: 'color', severity: 'P2', label: 'gradient-hex' },

  'keyword-text-white': { re: /\btext-white(?:\/\d+)?\b/g,         category: 'keyword',   severity: 'P2', label: 'text-white (review)' },
  'keyword-text-black': { re: /\btext-black(?:\/\d+)?\b/g,         category: 'keyword',   severity: 'P2', label: 'text-black (review)' },
  'keyword-bg-white':   { re: /\bbg-white(?:\/\d+)?\b/g,           category: 'keyword',   severity: 'P3', label: 'bg-white (review)' },
  'keyword-bg-black':   { re: /\bbg-black(?:\/\d+)?\b/g,           category: 'keyword',   severity: 'P3', label: 'bg-black (review)' },

  'tailwind-zinc':      { re: /\b(?:bg|text|border|from|to)-zinc-\d{2,3}(?:\/\d+)?\b/g, category: 'tailwind', severity: 'P2', label: 'tailwind zinc-*' },
  'tailwind-slate':     { re: /\b(?:bg|text|border|from|to)-slate-\d{2,3}(?:\/\d+)?\b/g, category: 'tailwind', severity: 'P2', label: 'tailwind slate-*' },
  'tailwind-gray':      { re: /\b(?:bg|text|border|from|to)-gray-\d{2,3}(?:\/\d+)?\b/g, category: 'tailwind', severity: 'P2', label: 'tailwind gray-*' },
  'tailwind-neutral':   { re: /\b(?:bg|text|border|from|to)-neutral-\d{2,3}(?:\/\d+)?\b/g, category: 'tailwind', severity: 'P2', label: 'tailwind neutral-*' },
  'tailwind-stone':     { re: /\b(?:bg|text|border|from|to)-stone-\d{2,3}(?:\/\d+)?\b/g, category: 'tailwind', severity: 'P2', label: 'tailwind stone-*' },

  'inline-style-color': { re: /style=\{\{[^}]*(?:color|background|backgroundColor|borderColor)[^}]*\}\}/g, category: 'inline', severity: 'P1', label: 'inline style with color' },
};

const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function flagValue(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
}
const limit = parseInt(flagValue('limit', '0'), 10);
const fileFilter = flagValue('file', null);
const patternFilter = flagValue('pattern', null);
const severityFilter = flagValue('severity', null);
const jsonOut = flag('json');
const mdOut = flag('md');

// ─── Source roots ──────────────────────────────────────────────────────
const SOURCE_ROOTS = [
  'src/tenants/arzadon',
  'src/app/(tenants)/sites/arzadon',
];

// ─── Helpers ───────────────────────────────────────────────────────────
function pathToRoute(rel) {
  // src/app/(tenants)/sites/arzadon/path/to/page.tsx → /path/to
  const m = rel.match(/^src\/app\/\(tenants\)\/sites\/arzadon(\/.*)?\/page\.tsx$/);
  if (m) return m[1] || '/';
  if (rel.includes('/components/')) {
    const cm = rel.match(/components\/([^/]+\/)?([^/]+)\.tsx$/);
    if (cm) return `<${cm[2]}>`;
  }
  return rel.replace('src/', '');
}

function findEnclosingJsxTag(content, matchIndex) {
  // Walk backward from matchIndex to find nearest unclosed `<TagName`
  // Returns: { tag, attrSnippet, lineNumber }
  let depth = 0;
  let i = matchIndex;
  while (i > 0) {
    if (content[i] === '>' && content[i - 1] !== '/') {
      // closing of an opening tag — need to skip the matching < going backward
      // Simpler: count `<` and `>` going backward, find the < that has depth balance 0
    }
    i--;
  }
  // Simpler approach: scan backward for `<` then check it's an opening tag
  i = matchIndex;
  while (i > 0) {
    if (content[i] === '<' && /[a-zA-Z]/.test(content[i + 1])) {
      // found a possible opening tag
      const closingGt = content.indexOf('>', i);
      const opener = content.slice(i, closingGt + 1);
      // Check this is the enclosing tag — does it close BEFORE matchIndex?
      // Yes if the matchIndex is BETWEEN i and the next `</` or self-close
      const tagMatch = opener.match(/^<(\w+)/);
      if (!tagMatch) { i--; continue; }
      const tag = tagMatch[1];
      // If self-closed, this tag's end is closingGt — match must be BEFORE closingGt to be inside attrs
      if (matchIndex < closingGt) {
        // We're inside the tag's attributes
        return { tag, opener, lineNumber: content.slice(0, i).split('\n').length };
      }
      i--;
      continue;
    }
    i--;
  }
  return null;
}

function findChildText(content, openingTagEnd) {
  // From openingTagEnd (right after `>`), scan for the first non-whitespace
  // up to the next `<`. Trim. Truncate to 60 chars.
  const slice = content.slice(openingTagEnd + 1, openingTagEnd + 500);
  const next = slice.indexOf('<');
  const text = (next === -1 ? slice : slice.slice(0, next)).trim();
  if (!text) return null;
  // Strip JSX braces and whitespace
  const cleaned = text.replace(/\s+/g, ' ').replace(/^\{|\}$/g, '').trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > 60 ? cleaned.slice(0, 60) + '…' : cleaned;
}

// ─── Scan ──────────────────────────────────────────────────────────────
const findings = [];

const files = fileFilter
  ? [resolve(ROOT, fileFilter)]
  : SOURCE_ROOTS.flatMap((r) => walk(resolve(ROOT, r)));

for (const path of files) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8');
  const rel = path.slice(ROOT.length + 1);

  for (const [name, { re, category, severity, label }] of Object.entries(PATTERNS)) {
    if (patternFilter && category !== patternFilter && name !== patternFilter) continue;
    if (severityFilter && severity.toLowerCase() !== severityFilter.toLowerCase()) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const matchText = m[0];
      const matchIndex = m.index;
      const jsx = findEnclosingJsxTag(content, matchIndex);
      const lineNumber = content.slice(0, matchIndex).split('\n').length;
      const tag = jsx?.tag ?? '?';
      const opener = jsx?.opener ?? '';
      const closingGt = opener ? content.indexOf('>', matchIndex - opener.length) : -1;
      const childText = closingGt >= 0 ? findChildText(content, closingGt) : null;

      findings.push({
        file: rel,
        page: pathToRoute(rel),
        line: lineNumber,
        tag,
        text: childText,
        match: matchText,
        category,
        severity,
        patternName: name,
        label,
      });
    }
  }
}

// ─── Report ────────────────────────────────────────────────────────────
if (jsonOut) {
  console.log(JSON.stringify(findings.slice(0, limit || findings.length), null, 2));
  process.exit(0);
}

// Group by file
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const fileEntries = [...byFile.entries()].sort();
const totalShown = limit > 0 ? limit : findings.length;
let shown = 0;

console.log(`# CSS Token Scan — ${new Date().toISOString().slice(0, 10)}`);
console.log('');
console.log(`**Total findings:** ${findings.length}`);
console.log('');
const byCat = {};
const bySev = {};
for (const f of findings) {
  byCat[f.category] = (byCat[f.category] ?? 0) + 1;
  bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
}
console.log('**By category:**');
for (const [c, n] of Object.entries(byCat)) console.log(`- ${c}: ${n}`);
console.log('');
console.log('**By severity:**');
for (const [s, n] of Object.entries(bySev).sort()) console.log(`- ${s}: ${n}`);
console.log('');

if (limit > 0) console.log(`*Showing first ${limit} findings.*`);
console.log('');
console.log('---');
console.log('');

for (const [file, list] of fileEntries) {
  if (shown >= totalShown && totalShown > 0) break;
  console.log(`## ${file}`);
  console.log(`*Page / context:* \`${list[0].page}\``);
  console.log('');
  for (const f of list) {
    if (shown >= totalShown && totalShown > 0) break;
    shown++;
    const textNote = f.text ? ` — text: \`"${f.text}"\`` : '';
    console.log(`- **L${f.line}** \`<${f.tag}>\`${textNote}`);
    console.log(`  - pattern: \`${f.match}\` *(${f.label} · ${f.severity})*`);
  }
  console.log('');
}

if (findings.length > shown) {
  console.log(`*...and ${findings.length - shown} more findings.*`);
}
