import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Trust-hierarchy lint (Block 12, FEATURES acceptance): Claude's interpretation
 * NEVER renders a number that isn't already in the statistical view, so a
 * `<ClaudeInsight>` element must never wrap a `<StatNumber>`. This scans every
 * TSX source and fails if any ClaudeInsight…</ClaudeInsight> span contains a
 * StatNumber — a static guard against the LLM becoming the source of a figure.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('trust hierarchy', () => {
  it('no <ClaudeInsight> wraps a <StatNumber>', () => {
    const offenders: string[] = [];
    const span = /<ClaudeInsight\b[^>]*>([\s\S]*?)<\/ClaudeInsight>/g;

    for (const file of tsxFiles(SRC)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(span)) {
        if (/<StatNumber\b/.test(match[1] ?? '')) {
          offenders.push(file.replace(SRC, 'src'));
        }
      }
    }

    expect(offenders, `ClaudeInsight must not wrap StatNumber: ${offenders.join(', ')}`).toEqual([]);
  });
});
