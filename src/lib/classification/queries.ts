/**
 * ABC/XYZ quadrant read model (Block 7). RLS-scoped: `product_classifications`
 * SELECT is tenant-scoped, and we keep only rows for active products.
 *
 * Shapes the flat classification rows into the 3×3 value × variability grid the
 * cockpit renders, plus the SKUs that have an ABC value rank but no XYZ yet
 * (no demand signal) so they aren't silently dropped.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbcClass, XyzClass } from './compute';

export const ABC_ROWS: AbcClass[] = ['A', 'B', 'C'];
export const XYZ_COLS: XyzClass[] = ['X', 'Y', 'Z'];

export interface QuadrantItem {
  productId: string;
  sku: string;
  name: string;
  value: number;
  adi: number | null;
  cv2: number | null;
}

export interface QuadrantCell {
  abc: AbcClass;
  xyz: XyzClass;
  count: number;
  totalValue: number;
  items: QuadrantItem[]; // value-descending
}

export interface Quadrant {
  computedAt: string | null;
  classified: number;
  cells: QuadrantCell[]; // 9, row-major A→C × X→Z
  awaitingSignal: QuadrantItem[]; // ABC ranked but no XYZ (no demand yet)
}

interface Row {
  product_id: string;
  abc_class: string | null;
  xyz_class: string | null;
  adi: number | string | null;
  cv_squared: number | string | null;
  annual_consumption_value: number | string | null;
  computed_at: string;
}

export async function loadQuadrant(supabase: SupabaseClient): Promise<Quadrant> {
  const [{ data: rows }, { data: products }] = await Promise.all([
    supabase
      .from('product_classifications')
      .select(
        'product_id, abc_class, xyz_class, adi, cv_squared, annual_consumption_value, computed_at',
      )
      .is('location_id', null)
      .returns<Row[]>(),
    supabase
      .from('products')
      .select('id, sku, name')
      .eq('status', 'active')
      .returns<{ id: string; sku: string; name: string }[]>(),
  ]);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  // Keep only the newest snapshot per SKU. The recompute writes the new snapshot
  // before deleting the old one; if that delete ever fails we'd see two rows for a
  // SKU, so dedupe defensively on computed_at rather than double-count it.
  const newestByProduct = new Map<string, Row>();
  for (const r of rows ?? []) {
    const prev = newestByProduct.get(r.product_id);
    if (!prev || r.computed_at > prev.computed_at) newestByProduct.set(r.product_id, r);
  }

  const key = (abc: string, xyz: string) => `${abc}${xyz}`;
  const buckets = new Map<string, QuadrantItem[]>();
  const awaiting: QuadrantItem[] = [];
  let computedAt: string | null = null;

  for (const r of newestByProduct.values()) {
    const p = productById.get(r.product_id);
    if (!p) continue; // classification for an archived/removed SKU
    if (r.computed_at && (!computedAt || r.computed_at > computedAt)) computedAt = r.computed_at;

    const item: QuadrantItem = {
      productId: r.product_id,
      sku: p.sku,
      name: p.name,
      value: num(r.annual_consumption_value),
      adi: r.adi == null ? null : num(r.adi),
      cv2: r.cv_squared == null ? null : num(r.cv_squared),
    };

    if (r.abc_class && r.xyz_class) {
      const list = buckets.get(key(r.abc_class, r.xyz_class)) ?? [];
      list.push(item);
      buckets.set(key(r.abc_class, r.xyz_class), list);
    } else if (r.abc_class) {
      awaiting.push(item);
    }
  }

  const cells: QuadrantCell[] = [];
  let classified = 0;
  for (const abc of ABC_ROWS) {
    for (const xyz of XYZ_COLS) {
      const items = (buckets.get(key(abc, xyz)) ?? []).sort((a, b) => b.value - a.value);
      classified += items.length;
      cells.push({
        abc,
        xyz,
        count: items.length,
        totalValue: items.reduce((a, b) => a + b.value, 0),
        items,
      });
    }
  }

  awaiting.sort((a, b) => b.value - a.value);
  return { computedAt, classified, cells, awaitingSignal: awaiting };
}

function num(v: number | string | null): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}
