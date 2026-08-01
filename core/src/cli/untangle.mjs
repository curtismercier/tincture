#!/usr/bin/env node
/**
 * tincture-untangle.mjs — Phase 1, cycle 2.
 *
 * Splits the [data-theme=*] axis into orthogonal [data-surface=*] x
 * [data-flavor=*]. Adds @import for tincture/flavors.css. Updates
 * ThemeProvider to write both attributes.
 *
 * Idempotent. --dry / --check / apply.
 *
 * See cycles/phase-1/cycle-2.md.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GLOBALS_PATH as GLOBALS, THEME_PROVIDER_PATH as PROVIDER, STORAGE_KEY } from './_resolve-config.mjs';

const dry = process.argv.includes('--dry');
const checkMode = process.argv.includes('--check');

const FLAVOR_IMPORT = `@import "./tincture/flavors.css";\n`;

const NEW_PROVIDER = `'use client';

/**
 * ThemeProvider — Tincture surface × flavor model (cycle 2 untangle).
 *
 * Today's storage value is a single 'theme' name (light|grey|dark|ember).
 * We DERIVE both data-surface and data-flavor from it and write BOTH on
 * <html>. This keeps every existing useTheme() caller working while
 * exposing the orthogonal axes for design tooling + future moods.
 *
 * Mapping (locked cycle 2):
 *   theme=light → surface=light, flavor=cool
 *   theme=grey  → surface=light, flavor=warm
 *   theme=dark  → surface=dark,  flavor=cool
 *   theme=ember → surface=dark,  flavor=ember
 *
 * Old [data-theme=*] attribute is STILL written for back-compat. Cycle
 * 7 drops it once every component reads only foundation tokens.
 *
 * Never return null while mounting — tanks Lighthouse perf.
 * next-themes' default behaviour is correct here.
 */

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes';
import { useEffect } from 'react';

const SURFACE_FOR: Record<string, 'light' | 'dark'> = {
  light: 'light',
  grey:  'light',
  dark:  'dark',
  ember: 'dark',
};

const FLAVOR_FOR: Record<string, 'cool' | 'warm' | 'ember'> = {
  light: 'cool',
  grey:  'warm',
  dark:  'cool',
  ember: 'ember',
};

function SurfaceFlavorWriter() {
  const { resolvedTheme, theme } = useNextTheme();
  useEffect(() => {
    const t = resolvedTheme || theme || 'grey';
    const root = document.documentElement;
    root.setAttribute('data-surface', SURFACE_FOR[t] ?? 'light');
    root.setAttribute('data-flavor', FLAVOR_FOR[t] ?? 'warm');
  }, [resolvedTheme, theme]);
  return null;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="grey"
      themes={['light', 'grey', 'dark', 'ember']}
      enableSystem={false}
      storageKey="${STORAGE_KEY}"
      disableTransitionOnChange={false}
    >
      <SurfaceFlavorWriter />
      {children}
    </NextThemesProvider>
  );
}

export function useTheme() {
  const { theme, setTheme } = useNextTheme();
  const resolved = (theme === 'dark' || theme === 'ember' ? 'dark' : 'light') as 'light' | 'dark';
  return {
    theme: resolved,
    toggleTheme: () => setTheme(resolved === 'dark' ? 'grey' : 'dark'),
  };
}
`;

const actions = [];

// 1. Insert flavors.css @import in globals.css
const globals = readFileSync(GLOBALS, 'utf8');
if (!globals.includes('tincture/flavors.css')) {
  // Insert AFTER the existing tincture/foundation.css import.
  const next = globals.replace(
    /(@import "\.\/tincture\/foundation\.css";\s*\n)/,
    `$1${FLAVOR_IMPORT}`,
  );
  if (next === globals) {
    actions.push({ kind: 'warn', path: 'globals.css', note: 'foundation.css import not found; cycle 1 may not have run' });
  } else {
    if (!dry && !checkMode) writeFileSync(GLOBALS, next, 'utf8');
    actions.push({ kind: 'patch', path: GLOBALS, note: 'inserted @import "./tincture/flavors.css"' });
  }
}

// 2. Replace ThemeProvider with surface+flavor writer
const provider = readFileSync(PROVIDER, 'utf8');
if (!provider.includes('SurfaceFlavorWriter')) {
  if (!dry && !checkMode) writeFileSync(PROVIDER, NEW_PROVIDER, 'utf8');
  actions.push({ kind: 'rewrite', path: PROVIDER, note: 'added SurfaceFlavorWriter, ember theme registered' });
}

// Report
console.log('tincture-untangle — cycle 2');
console.log('');
if (actions.length === 0) {
  console.log('no actions — already up-to-date.');
} else {
  for (const a of actions) {
    console.log(`  ${a.kind.padEnd(8)} ${a.path}  (${a.note})`);
  }
}
console.log(`\nmode: ${dry ? 'dry-run' : checkMode ? 'check' : 'apply'}`);

if (checkMode) {
  const pending = actions.filter((a) => ['patch', 'rewrite', 'create'].includes(a.kind));
  if (pending.length > 0) {
    console.error(`\nx ${pending.length} action(s) pending.`);
    process.exit(1);
  }
  console.log('clean.');
  process.exit(0);
}
