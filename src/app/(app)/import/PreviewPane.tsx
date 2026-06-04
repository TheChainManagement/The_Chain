'use client';

import { type ReactNode, useMemo } from 'react';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { KindSpec } from '@/lib/import/field-specs';
import type { ColumnMapping } from '@/lib/import/mapping';
import { type MapRowsResult, rowToPayload } from '@/lib/import/transform';
import styles from './import.module.css';

const PREVIEW_ROWS = 50;

/**
 * PreviewPane — the dry run. The first 50 rows rendered against the canonical
 * model, valid/skip counts up top, and the failure list with CSV row numbers so
 * the user can fix the source and re-upload. Nothing is written here.
 */
export function PreviewPane({
  spec,
  rows,
  mapping,
  validation,
}: {
  spec: KindSpec;
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  validation: MapRowsResult;
}): ReactNode {
  const preview = useMemo(
    () => rows.slice(0, PREVIEW_ROWS).map((row, i) => rowToPayload(i + 1, row, spec, mapping)),
    [rows, spec, mapping],
  );

  const failTone = validation.errors.length > 0 ? 'warn' : 'flow';

  return (
    <div className={styles.previewStack}>
      <div className={styles.previewStats}>
        <StatNumber
          value={validation.payloads.length}
          label="Ready to import"
          tone="flow"
          size="panel"
        />
        <StatNumber
          value={validation.errors.length}
          label="Rows skipped"
          tone={failTone}
          size="panel"
        />
        <StatNumber value={validation.total} label="Rows in file" tone="deep" size="panel" />
      </div>

      <Panel prefix="Dry run" title={`First ${Math.min(PREVIEW_ROWS, rows.length)} rows`}>
        <div className={styles.previewTableWrap}>
          <table className={styles.previewTable}>
            <thead>
              <tr>
                <th className={styles.rowNo}>Row</th>
                {spec.fields.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((result) => (
                <tr key={result.row} data-bad={result.payload ? undefined : true}>
                  <td className={styles.rowNo}>{result.row}</td>
                  {spec.fields.map((f) => {
                    const value = result.payload
                      ? formatValue((result.payload.attributes as Record<string, unknown>)[f.key])
                      : formatValue(mappedCell(rows[result.row - 1], mapping[f.key] ?? null));
                    return <td key={f.key}>{value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {validation.errors.length > 0 ? (
        <Panel prefix="Skipped" title={`${validation.errors.length} rows need a fix`}>
          <ul className={styles.failList}>
            {validation.errors.slice(0, 12).map((e) => (
              <li key={`${e.row}-${e.field ?? e.code}`} className={styles.failItem}>
                <span className={styles.failRow}>Row {e.row}</span>
                <span className={styles.failMsg}>{e.message}</span>
              </li>
            ))}
            {validation.errors.length > 12 ? (
              <li className={styles.failMore}>
                + {validation.errors.length - 12} more. Fix the source and re-upload.
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function mappedCell(row: Record<string, string> | undefined, header: string | null): unknown {
  if (!row || !header) return undefined;
  return row[header];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}
