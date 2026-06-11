import Link from 'next/link';
import type { ReactNode } from 'react';
import { ClassificationBadge } from '@/components/ClassificationBadge/ClassificationBadge';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { type Quadrant, type QuadrantCell, XYZ_COLS } from '@/lib/classification/queries';
import styles from './classification.module.css';

/**
 * Presentational ABC/XYZ grid (Block 7). Pure render over a `Quadrant` — the page
 * loads the data, this draws it, and the gallery renders it with fixtures for the
 * visible-craft capture. Rows are ABC value rank (A on top), columns are XYZ
 * variability (X stable → Z erratic); the A/B·Z watch corner is lit.
 */

const XYZ_SUB: Record<string, string> = { X: 'stable', Y: 'variable', Z: 'erratic' };
const ABC_SUB: Record<string, string> = { A: 'vital few', B: 'significant', C: 'trivial many' };
const TILES_PER_CELL = 4;

export function QuadrantGrid({ quadrant }: { quadrant: Quadrant }): ReactNode {
  const rows = ['A', 'B', 'C'].map((abc) => ({
    abc,
    cells: quadrant.cells.filter((c) => c.abc === abc),
  }));

  return (
    <>
      <div className={styles.grid} role="table" aria-label="ABC by XYZ classification grid">
        <div className={styles.corner} role="presentation" />
        {XYZ_COLS.map((xyz) => (
          <div key={xyz} className={styles.colHead} role="columnheader">
            <span className={styles.headGlyph}>{xyz}</span>
            <span className={styles.headSub}>{XYZ_SUB[xyz]}</span>
          </div>
        ))}

        {rows.map((row) => (
          <RowGroup key={row.abc} abc={row.abc} cells={row.cells} />
        ))}
      </div>

      {quadrant.awaitingSignal.length > 0 ? (
        <Panel
          prefix="Awaiting signal"
          title={`${quadrant.awaitingSignal.length} ranked by value, no variability yet`}
        >
          <p className={styles.awaitingCopy}>
            These SKUs have an ABC value rank but not enough demand history to score variability.
            They pick up an XYZ class once sales accumulate.
          </p>
          <div className={styles.awaitingList}>
            {quadrant.awaitingSignal.slice(0, 12).map((it) => (
              <Link
                key={it.productId}
                href={`/inventory/${it.productId}`}
                className={styles.awaitingTile}
              >
                <span className={styles.tileSku}>{it.sku}</span>
                <ClassificationBadge abc="?" xyz={null} />
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function RowGroup({ abc, cells }: { abc: string; cells: QuadrantCell[] }): ReactNode {
  return (
    <>
      <div className={styles.rowHead} role="rowheader">
        <span className={styles.headGlyph}>{abc}</span>
        <span className={styles.headSub}>{ABC_SUB[abc]}</span>
      </div>
      {cells.map((cell) => (
        <Cell key={`${cell.abc}${cell.xyz}`} cell={cell} />
      ))}
    </>
  );
}

function Cell({ cell }: { cell: QuadrantCell }): ReactNode {
  // The watch corner: high value + erratic demand (A/B × Z).
  const isWatch = cell.xyz === 'Z' && (cell.abc === 'A' || cell.abc === 'B') && cell.count > 0;
  const className = [
    styles.cell,
    isWatch ? styles.watch : '',
    cell.count === 0 ? styles.cellEmpty : '',
  ]
    .join(' ')
    .trim();

  return (
    <div className={className} role="cell">
      <div className={styles.cellHead}>
        <StatNumber value={cell.count} size="panel" tone={isWatch ? 'warn' : 'deep'} />
        {cell.totalValue > 0 ? (
          <span className={styles.cellValue}>${compact(cell.totalValue)}</span>
        ) : null}
      </div>
      {isWatch ? <span className={styles.watchTag}>WATCH</span> : null}
      <div className={styles.tiles}>
        {cell.items.slice(0, TILES_PER_CELL).map((it) => (
          <Link key={it.productId} href={`/inventory/${it.productId}`} className={styles.tile}>
            <span className={styles.tileSku}>{it.sku}</span>
            <ClassificationBadge abc={cell.abc} xyz={cell.xyz} />
          </Link>
        ))}
        {cell.count > TILES_PER_CELL ? (
          <span className={styles.tileMore}>+{cell.count - TILES_PER_CELL} more</span>
        ) : null}
      </div>
    </div>
  );
}

/** Compact value: 1.2k / 18.4k / 1.1M. */
function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
