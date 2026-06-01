#!/usr/bin/env node
/**
 * verify:foundation — the Foundation block's "What's memorable" artifact.
 *
 * Runs the foundation probe suite (cross-tenant RLS, role matrix, audit
 * dispatcher, wired-for dry runs) plus the craft guard, and prints ONE page that
 * reads like a daylight engineering inspection sheet: every guarantee as a
 * checked box, not a wall of test names. Exits non-zero if any check fails.
 *
 * Requires `supabase start` running (the probes hit local Postgres).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCraft } from './check-craft.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const vitestBin = join(root, 'node_modules', '.bin', 'vitest');
const outFile = join(mkdtempSync(join(tmpdir(), 'verify-foundation-')), 'results.json');

// Friendly row per test file.
const ROWS = [
  { file: 'rls-cross-tenant.test.ts', label: 'Tenant isolation · cross-tenant RLS + writes' },
  { file: 'claim-integrity.test.ts', label: 'Claim integrity · no tenant-id spoofing' },
  { file: 'role-matrix.test.ts', label: 'Role matrix · every role gated per the matrix' },
  { file: 'audit-triggers.test.ts', label: 'Audit dispatcher · every tenant table' },
  { file: 'wired-for.test.ts', label: 'Wired-for dry runs · Waves 2–7 + pricing' },
];

let results;
try {
  execFileSync(
    vitestBin,
    ['run', 'tests/foundation', '--reporter=json', `--outputFile=${outFile}`],
    {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
} catch {
  // Non-zero exit just means some test failed; the JSON still has details.
}
results = JSON.parse(readFileSync(outFile, 'utf8'));

// Aggregate pass/total per file.
const perFile = new Map();
for (const tr of results.testResults ?? []) {
  const base = tr.name.split('/').pop();
  const total = tr.assertionResults?.length ?? 0;
  const passed = (tr.assertionResults ?? []).filter((a) => a.status === 'passed').length;
  perFile.set(base, { passed, total });
}

const craft = checkCraft();

const lines = [];
const WIDTH = 57;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR codes requires the ESC control char
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const box = (s) => {
  const pad = Math.max(0, WIDTH - stripAnsi(s).length);
  lines.push('  │ ' + s + ' '.repeat(pad) + ' │');
};
const mark = (ok) => (ok ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m');

const INNER = WIDTH + 2; // chars between the corner glyphs
const title = '─ THE CHAIN · FOUNDATION INSPECTION ';
lines.push('');
lines.push('  ┌' + title + '─'.repeat(Math.max(0, INNER - title.length)) + '┐');
box('');
let allGreen = true;
let totalChecks = 0;
for (const row of ROWS) {
  const r = perFile.get(row.file) ?? { passed: 0, total: 0 };
  const ok = r.total > 0 && r.passed === r.total;
  allGreen = allGreen && ok;
  totalChecks += r.total;
  const count = `${r.passed}/${r.total}`;
  box(`${mark(ok)}  ${row.label}`);
  box(`        ${count.padStart(6)} checks`);
}
box('');
box(`${mark(craft.tokenDiscipline.ok)}  Token discipline · no hex / font literals`);
box(`${mark(craft.trustHierarchy.ok)}  Trust hierarchy · canonical render paths`);
allGreen = allGreen && craft.tokenDiscipline.ok && craft.trustHierarchy.ok;
box('');
lines.push('  ├' + '─'.repeat(INNER) + '┤');
const verdict = allGreen
  ? `${totalChecks} checks green · the foundation is load-bearing`
  : 'FOUNDATION NOT SOUND · see failures above';
box(`${allGreen ? '\x1b[32m●\x1b[0m' : '\x1b[31m●\x1b[0m'} ${verdict}`);
lines.push('  └' + '─'.repeat(INNER) + '┘');
lines.push('');

if (!craft.tokenDiscipline.ok) {
  lines.push('  Token violations:');
  for (const v of craft.tokenDiscipline.violations) lines.push('    ' + v);
}

console.log(lines.join('\n'));
process.exit(allGreen ? 0 : 1);
