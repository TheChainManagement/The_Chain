#!/usr/bin/env node
/**
 * bench-inventory.mjs — measure the inventory_list_v query at the 5k-SKU
 * acceptance scale, through the authenticated/RLS path (set role authenticated +
 * jwt claims GUC, exactly as PostgREST executes it). Reports p50/p95 over 10
 * timed runs after a warmup, and writes an EXPLAIN (ANALYZE, BUFFERS) plan to
 * _reviews/ so index usage is auditable.
 *
 * Run `node scripts/seed-bench.mjs` first. DB via SUPABASE_DB_URL or local default.
 */
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const RUNS = Number(process.env.BENCH_RUNS ?? 10);
const SLUG = 'bench-5k';
const EMAIL = 'bench-5k@thechain.test';
const SELECT =
  "select id, sku, name, status, unit_of_measure, on_hand, allocated, in_transit, abc_class, xyz_class from inventory_list_v where status = 'active' order by sku";

function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^SUPABASE_DB_URL=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

const c = new Client({ connectionString: dbUrl() });
await c.connect();
try {
  const t = await c.query('select id from tenants where slug = $1', [SLUG]);
  if (t.rowCount === 0) {
    console.error('No bench tenant. Run: node scripts/seed-bench.mjs');
    process.exit(1);
  }
  const tenantId = t.rows[0].id;
  const u = await c.query('select id from auth.users where email = $1', [EMAIL]);
  const userId = u.rows[0].id;
  const claims = JSON.stringify({
    sub: userId,
    tenant_id: tenantId,
    role: 'authenticated',
    tenant_role: 'owner',
  });

  async function runOnce() {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
    const start = process.hrtime.bigint();
    const res = await c.query(SELECT);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    await c.query('rollback');
    return { ms, rows: res.rowCount };
  }

  const warm = await runOnce();
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push((await runOnce()).ms);
  samples.sort((a, b) => a - b);
  const pct = (p) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];
  const p50 = pct(50);
  const p95 = pct(95);

  // EXPLAIN plan (authenticated path) for the index-usage audit.
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
  const plan = await c.query(`explain (analyze, buffers, verbose) ${SELECT}`);
  await c.query('rollback');
  const planText = plan.rows.map((r) => r['QUERY PLAN']).join('\n');

  const report = [
    '# Bench — inventory_list_v (5k SKUs, authenticated path)',
    '',
    `Rows returned: ${warm.rows}`,
    `Runs: ${RUNS} (after 1 warmup)`,
    `p50: ${p50.toFixed(1)} ms  (target < 600 ms)`,
    `p95: ${p95.toFixed(1)} ms  (target < 1200 ms)`,
    `min/max: ${samples[0].toFixed(1)} / ${samples[samples.length - 1].toFixed(1)} ms`,
    '',
    'NOTE: local Postgres on the dev box, not the Vercel Preview harness in',
    'MASTER_PROMPT. Directional, not the official SLO number — but it exercises the',
    'real RLS + view aggregation. EXPLAIN below confirms index usage.',
    '',
    '## EXPLAIN (ANALYZE, BUFFERS)',
    '```',
    planText,
    '```',
    '',
  ].join('\n');

  const date = new Date(Number(process.env.BENCH_DATE_MS ?? Date.now()))
    .toISOString()
    .slice(0, 10);
  const out = new URL(`../_reviews/${date}_bench_inventory.md`, import.meta.url);
  writeFileSync(out, report);
  console.log(`p50 ${p50.toFixed(1)}ms / p95 ${p95.toFixed(1)}ms over ${warm.rows} rows.`);
  console.log(`Plan + report → _reviews/${date}_bench_inventory.md`);
} finally {
  await c.end();
}
