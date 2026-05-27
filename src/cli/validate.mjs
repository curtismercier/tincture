#!/usr/bin/env node
/**
 * validate.mjs — registry validation via schema.mjs
 *
 * Validates a Tincture registry.json against the canonical schema
 * defined in src/schema.mjs. Covers:
 *   - Required fields per token type
 *   - Axis-cell key format
 *   - Default cell requirement
 *   - Locked token constraints
 *
 * Usage:
 *   tincture validate                          # uses _resolve-config.mjs
 *   node src/cli/validate.mjs --registry <path>
 *
 * Exit 0 if valid, 1 if validation errors.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRegistry } from '../schema.mjs';

let REGISTRY_PATH;
try {
  const { REGISTRY_PATH: p } = await import('./_resolve-config.mjs');
  REGISTRY_PATH = p;
} catch {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--registry');
  REGISTRY_PATH = idx >= 0
    ? resolve(process.cwd(), args[idx + 1])
    : resolve(process.cwd(), 'tincture/registry.json');
}

if (!existsSync(REGISTRY_PATH)) {
  console.error(`✖ registry.json not found at ${REGISTRY_PATH}`);
  process.exit(1);
}

const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const result = validateRegistry(reg);

if (result.ok) {
  const tokenCount = Object.keys(reg.tokens ?? {}).length;
  console.log(`✓ ${tokenCount} token(s) — valid`);
  process.exit(0);
} else {
  console.error(`✖ ${result.errors.length} validation error(s):`);
  for (const err of result.errors) console.error(`  • ${err}`);
  process.exit(1);
}
