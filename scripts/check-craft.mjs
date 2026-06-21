#!/usr/bin/env node
/**
 * Craft guard — token discipline + trust hierarchy. Part of `verify:foundation`.
 *
 * Enforces the Codex Foundation checklist mechanically:
 *   - No hardcoded hex colors anywhere in src/ except the token file
 *     (src/styles/globals.css). Everything else references var(--color-*).
 *   - No font-family literals outside the token file (must be var(--font-*)).
 *   - The three trust-hierarchy render paths exist (StatNumber / ClaudeInsight /
 *     ActionButton) — the only sanctioned ways to render a number, Claude prose,
 *     or a user action.
 *
 * Exits non-zero on any violation. Returns a small report object when imported.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const TOKEN_FILE = 'styles/globals.css';
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FONT_FAMILY_LITERAL = /font-family:\s*["']/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

export function checkCraft() {
  const files = walk(SRC);
  const violations = [];

  for (const file of files) {
    const rel = file.slice(SRC.length);
    if (rel === TOKEN_FILE) continue; // the one place literals are allowed
    // OG/social images are rendered server-side by satori (next/og ImageResponse),
    // which cannot resolve CSS custom properties — colors MUST be literal there.
    // Same carve-out spirit as the token file; the colors still mirror globals.css.
    if (/(^|\/)(opengraph|twitter)-image\.tsx$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (HEX.test(line)) violations.push(`${rel}:${i + 1} hardcoded color: ${line.trim()}`);
      if (FONT_FAMILY_LITERAL.test(line))
        violations.push(`${rel}:${i + 1} font-family literal: ${line.trim()}`);
    });
  }

  const canonical = [
    'components/StatNumber/StatNumber.tsx',
    'components/ClaudeInsight/ClaudeInsight.tsx',
    'components/ActionButton/ActionButton.tsx',
  ];
  const missing = canonical.filter((c) => !files.some((f) => f.endsWith(c)));

  return {
    tokenDiscipline: { ok: violations.length === 0, violations },
    trustHierarchy: { ok: missing.length === 0, missing },
  };
}

// CLI mode (robust to spaces in the path — fileURLToPath decodes %20)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = checkCraft();
  if (!r.tokenDiscipline.ok) {
    console.error('Token discipline FAILED:');
    for (const v of r.tokenDiscipline.violations) console.error('  ' + v);
  }
  if (!r.trustHierarchy.ok) {
    console.error('Trust hierarchy FAILED — missing: ' + r.trustHierarchy.missing.join(', '));
  }
  if (r.tokenDiscipline.ok && r.trustHierarchy.ok) {
    console.log('Craft guard PASS: token discipline + trust hierarchy intact.');
    process.exit(0);
  }
  process.exit(1);
}
