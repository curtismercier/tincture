#!/usr/bin/env node
/**
 * tincture-preview.mjs — cycle 9.
 *
 * Produces the 4-state preview: a 2x2 image grid showing CURRENT and
 * PROPOSED values of a token in both light and dark surface contexts.
 *
 * Architecture:
 *   - Builds URLs that target the studio-designer iframe protocol:
 *     `<page>?designer=1&theme=<grey|dark>&data=<base64-json>`
 *     where data carries `{ root: { '--<id>': '<value>' } }`
 *   - Connects to a running Brave/Chrome via CDP (CDP_URL env, default
 *     http://localhost:9333) and captures each URL.
 *   - Writes individual captures + a 2x2 mosaic to .tincture-cache/
 *
 * Usage:
 *   tincture preview <token-id> --light <hex> --dark <hex> [--page <route>]
 *
 * Default page: /personal-trainer-toronto (token-dense, surface-flipping).
 *
 * Falls back to URL-only mode (no captures) if puppeteer-core can't
 * connect — useful for agents that have their own browser tool.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const CACHE = resolve(ROOT, '.tincture-cache'); // cache in consumer project
const CDP_URL = process.env.CDP_URL || 'http://localhost:9333';
import { HOST } from './_resolve-config.mjs';

const args = process.argv.slice(2);
const tokenId = args[0];
function flagValue(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  if (args[i].includes('=')) return args[i].split('=')[1];
  return args[i + 1] ?? fallback;
}
const lightProposed = flagValue('light');
const darkProposed = flagValue('dark');
const page = flagValue('page', '/personal-trainer-toronto');
const urlsOnly = args.includes('--urls-only');

if (!tokenId) {
  console.error('usage: tincture preview <token-id> --light <hex> --dark <hex> [--page <route>]');
  process.exit(2);
}
if (!lightProposed && !darkProposed) {
  console.error('error: at least one of --light / --dark must be set');
  process.exit(2);
}

if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

// Build override map for the proposed state
function buildOverrideHash({ light, dark }) {
  // Designer studio's DesignerOverrides reads `?data=<base64-json>` (per
  //  fix). The shape is { root: {...}, page, section, tone }.
  // We only override at root for token previews.
  const overrides = { root: {}, page: {}, section: {}, tone: {} };
  if (light) overrides.root[`--${tokenId}`] = light; // designer overrides ignore surface
  if (dark) overrides.root[`--${tokenId}`] = dark;
  return Buffer.from(JSON.stringify(overrides)).toString('base64');
}

const lightCurrent = `https://${HOST}${page}?designer=1&theme=grey`;
const darkCurrent  = `https://${HOST}${page}?designer=1&theme=dark`;
const lightProposedUrl = lightProposed
  ? `https://${HOST}${page}?designer=1&theme=grey&data=${buildOverrideHash({ light: lightProposed })}`
  : lightCurrent;
const darkProposedUrl = darkProposed
  ? `https://${HOST}${page}?designer=1&theme=dark&data=${buildOverrideHash({ dark: darkProposed })}`
  : darkCurrent;

const urls = {
  'light-current':  lightCurrent,
  'light-proposed': lightProposedUrl,
  'dark-current':   darkCurrent,
  'dark-proposed':  darkProposedUrl,
};

console.log(`tincture-preview — token --${tokenId} on ${page}`);
console.log('');
console.log('URLs:');
for (const [k, u] of Object.entries(urls)) console.log(`  ${k.padEnd(16)} ${u}`);
console.log('');

if (urlsOnly) {
  console.log('--urls-only — skipping captures.');
  process.exit(0);
}

// Try puppeteer-core via CDP
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.log('puppeteer-core not available — URLs printed above; run with --urls-only or visit them via your browser tool.');
  process.exit(0);
}

let browser;
try {
  browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
} catch (e) {
  console.error(`x cannot connect to CDP at ${CDP_URL}. Start Brave/Chrome with --remote-debugging-port=9333. URLs printed above.`);
  process.exit(0);
}

const sha = Date.now().toString(36);
const captures = {};
for (const [name, url] of Object.entries(urls)) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await tab.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500)); // animations settle
  const out = join(CACHE, `${tokenId}-${name}-${sha}.jpg`);
  await tab.screenshot({ path: out, type: 'jpeg', quality: 85, fullPage: false });
  await tab.close();
  captures[name] = out;
  console.log(`  ✓ ${name}: ${out}`);
}

await browser.disconnect();
console.log('');
console.log('Captured. Compose into a 2x2 mosaic via your tool of choice, e.g.:');
for (const k of ['light-current', 'light-proposed', 'dark-current', 'dark-proposed']) {
  console.log(`  ${k}: ${captures[k]}`);
}
console.log(`  output target: ${CACHE}/${tokenId}-mosaic-${sha}.jpg`);
console.log('');
console.log(`  Then read the mosaic to see the 2x2 visual diff.`);
