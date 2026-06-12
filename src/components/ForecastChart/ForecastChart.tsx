import type { ReactNode } from 'react';
import type { ForecastPointRow } from '@/lib/forecast/detail';
import type { SeriesPoint } from '@/lib/forecast/series';
import styles from './ForecastChart.module.css';

/**
 * ForecastChart — the workshop's centerpiece (Block 8, FEATURES memorable
 * element). Hand-rolled SVG, tokens only:
 *
 *  - HISTORY: weekly demand as a 1px deep-slate line with square markers —
 *    exactly the series the model trained on.
 *  - FORECAST: forward mean points with the 80%/95% confidence bands drawn as
 *    per-week vertical pewter ranges (1px hairline for 95%, a heavier inner
 *    tick for 80%) that widen with the horizon. Never filled, never cobalt —
 *    the FEATURES trust rule.
 *  - TODAY: one small cobalt diamond on the boundary (the chart's single
 *    cobalt intent) over a faint signal-line rule.
 *
 * Pure presentational: the page loads data, this draws it; the gallery and the
 * memorable artifact drive it with fixtures.
 */

export interface ForecastChartProps {
  history: SeriesPoint[];
  points: ForecastPointRow[];
  /** Accessible summary, e.g. "RVB-1107 demand history and 8-week forecast". */
  label: string;
}

const W = 720;
const H = 220;
const PAD = { top: 26, right: 14, bottom: 26, left: 40 };

export function ForecastChart({ history, points, label }: ForecastChartProps): ReactNode {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const n = history.length + points.length;
  if (n === 0) return null;

  const yMax = Math.max(
    1,
    ...history.map((h) => h.y),
    ...points.flatMap((p) => [p.mean ?? 0, p.hi95 ?? 0, p.hi80 ?? 0]),
  );

  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(v, yMax) / yMax) * innerH;

  // The today boundary sits between the last history week and the first
  // forecast week (or at the lone region's edge when one side is empty).
  const boundaryX =
    history.length === 0
      ? PAD.left
      : points.length === 0
        ? PAD.left + innerW
        : (x(history.length - 1) + x(history.length)) / 2;

  const historyPath = history
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(h.y).toFixed(1)}`)
    .join(' ');

  const gridValues = [yMax, yMax / 2];
  const tickEvery = Math.max(1, Math.round(n / 9));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.chart}
      role="img"
      aria-label={label}
      data-testid="forecast-chart"
    >
      {/* gridlines + y labels */}
      {gridValues.map((v) => (
        <g key={v}>
          <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
          <text className={styles.tick} x={PAD.left - 6} y={y(v) + 3} textAnchor="end">
            {fmt(v)}
          </text>
        </g>
      ))}
      <line
        className={styles.axis}
        x1={PAD.left}
        x2={W - PAD.right}
        y1={PAD.top + innerH}
        y2={PAD.top + innerH}
      />

      {/* region eyebrows */}
      {history.length > 0 ? (
        <text className={styles.region} x={PAD.left} y={14}>
          HISTORY · WEEKLY DEMAND
        </text>
      ) : null}
      {points.length > 0 ? (
        <text className={styles.region} x={W - PAD.right} y={14} textAnchor="end">
          FORECAST · {points.length} WK
        </text>
      ) : null}

      {/* history line + square markers */}
      {history.length > 1 ? <path className={styles.historyLine} d={historyPath} /> : null}
      {history.map((h, i) => (
        <rect
          key={h.ds}
          className={styles.historyDot}
          x={x(i) - 1.8}
          y={y(h.y) - 1.8}
          width={3.6}
          height={3.6}
          data-testid="history-dot"
        />
      ))}

      {/* forecast bands + means */}
      {points.map((p, j) => {
        const i = history.length + j;
        return (
          <g key={p.ds}>
            {p.lo95 != null && p.hi95 != null ? (
              <line
                className={styles.band95}
                x1={x(i)}
                x2={x(i)}
                y1={y(p.lo95)}
                y2={y(p.hi95)}
                data-testid="band-95"
              />
            ) : null}
            {p.lo80 != null && p.hi80 != null ? (
              <line
                className={styles.band80}
                x1={x(i)}
                x2={x(i)}
                y1={y(p.lo80)}
                y2={y(p.hi80)}
                data-testid="band-80"
              />
            ) : null}
            {p.mean != null ? (
              <circle
                className={styles.meanDot}
                cx={x(i)}
                cy={y(p.mean)}
                r={2.6}
                data-testid="forecast-mean"
              />
            ) : null}
          </g>
        );
      })}

      {/* today: faint signal rule + the cobalt diamond (the one cobalt intent) */}
      <line
        className={styles.todayRule}
        x1={boundaryX}
        x2={boundaryX}
        y1={PAD.top}
        y2={PAD.top + innerH}
      />
      <rect
        className={styles.todayDiamond}
        x={boundaryX - 4}
        y={PAD.top + innerH - 4}
        width={8}
        height={8}
        transform={`rotate(45 ${boundaryX} ${PAD.top + innerH})`}
        data-testid="today-diamond"
      />
      <text className={styles.todayLabel} x={boundaryX} y={H - 6} textAnchor="middle">
        TODAY
      </text>

      {/* x ticks (mono, sparse) */}
      {Array.from({ length: n }, (_, i) => i)
        .filter((i) => i % tickEvery === 0 && Math.abs(x(i) - boundaryX) > 24)
        .map((i) => {
          const ds = i < history.length ? history[i]?.ds : points[i - history.length]?.ds;
          if (!ds) return null;
          return (
            <text key={ds} className={styles.tick} x={x(i)} y={H - 6} textAnchor="middle">
              {ds.slice(5)}
            </text>
          );
        })}
    </svg>
  );
}

function fmt(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
}
