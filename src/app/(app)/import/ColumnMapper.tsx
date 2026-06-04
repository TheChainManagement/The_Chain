'use client';

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CanonicalFieldSpec, KindSpec } from '@/lib/import/field-specs';
import type { ColumnMapping } from '@/lib/import/mapping';
import styles from './import.module.css';

/**
 * ColumnMapper — Block 5's memorable element.
 *
 * The workshop pegboard: CSV columns on the left, The Chain's canonical fields on
 * the right, wired together by cobalt connector lines. Auto-mapped columns open
 * pre-wired; the user drags from a left port to a right field (or clicks one then
 * the other) to rewire. The cobalt connector is the single Chain intent slot on
 * this surface (MASTER_PROMPT), the same signal as a lit chain link.
 */

interface Wire {
  fieldKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface DragState {
  header: string;
  x: number;
  y: number;
}

export function ColumnMapper({
  spec,
  headers,
  sampleRow,
  mapping,
  onChange,
}: {
  spec: KindSpec;
  headers: string[];
  sampleRow: Record<string, string>;
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftNubs = useRef<Map<string, HTMLElement>>(new Map());
  const rightNubs = useRef<Map<string, HTMLElement>>(new Map());

  const [wires, setWires] = useState<Wire[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverField, setHoverField] = useState<string | null>(null);

  // header currently wired to a given field (reverse of mapping)
  const headerForField = (fieldKey: string): string | null => mapping[fieldKey] ?? null;

  const connect = useCallback(
    (header: string, fieldKey: string) => {
      const next: ColumnMapping = { ...mapping };
      // A header maps to at most one field: drop it from any other field first.
      for (const key of Object.keys(next)) {
        if (next[key] === header) next[key] = null;
      }
      next[fieldKey] = header;
      onChange(next);
      setArmed(null);
    },
    [mapping, onChange],
  );

  const unwire = useCallback(
    (fieldKey: string) => {
      if (!mapping[fieldKey]) return;
      onChange({ ...mapping, [fieldKey]: null });
    },
    [mapping, onChange],
  );

  // ----- geometry -----
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    const next: Wire[] = [];
    for (const field of spec.fields) {
      const header = mapping[field.key];
      if (!header) continue;
      const leftEl = leftNubs.current.get(header);
      const rightEl = rightNubs.current.get(field.key);
      if (!leftEl || !rightEl) continue;
      const l = leftEl.getBoundingClientRect();
      const r = rightEl.getBoundingClientRect();
      next.push({
        fieldKey: field.key,
        x1: l.right - crect.left,
        y1: l.top - crect.top + l.height / 2,
        x2: r.left - crect.left,
        y2: r.top - crect.top + r.height / 2,
      });
    }
    setWires(next);
  }, [mapping, spec.fields]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // ----- drag wiring -----
  useEffect(() => {
    if (!drag) return;
    const container = containerRef.current;
    if (!container) return;

    function onMove(e: PointerEvent) {
      const crect = containerRef.current?.getBoundingClientRect();
      if (!crect) return;
      setDrag((d) => (d ? { ...d, x: e.clientX - crect.left, y: e.clientY - crect.top } : d));
    }
    function onUp() {
      setDrag((d) => {
        if (d && hoverField) connect(d.header, hoverField);
        return null;
      });
      setHoverField(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, hoverField, connect]);

  function startDrag(header: string, e: ReactPointerEvent): void {
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    setArmed(header);
    setDrag({ header, x: e.clientX - crect.left, y: e.clientY - crect.top });
  }

  function clickLeft(header: string): void {
    setArmed((cur) => (cur === header ? null : header));
  }
  function clickField(fieldKey: string): void {
    if (armed) connect(armed, fieldKey);
  }

  const dragWire = drag
    ? dragOrigin(leftNubs.current.get(drag.header), containerRef.current)
    : null;

  return (
    <div className={styles.mapper} ref={containerRef}>
      <svg className={styles.wires} aria-hidden="true">
        <title>Column connections</title>
        {wires.map((w) => (
          <path key={w.fieldKey} className={styles.wire} d={bezier(w.x1, w.y1, w.x2, w.y2)} />
        ))}
        {drag && dragWire ? (
          <path className={styles.wireLive} d={bezier(dragWire.x, dragWire.y, drag.x, drag.y)} />
        ) : null}
      </svg>

      <div className={styles.column}>
        <span className={styles.columnHead}>Your CSV</span>
        {headers.map((header) => {
          const used = Object.values(mapping).includes(header);
          return (
            <button
              key={header}
              type="button"
              className={`${styles.port} ${styles.portLeft} ${armed === header ? styles.portArmed : ''} ${used ? styles.portUsed : ''}`}
              onClick={() => clickLeft(header)}
            >
              <span className={styles.portName}>{header}</span>
              <span className={styles.portSample}>{sampleRow[header] || '—'}</span>
              <span
                className={styles.nubRight}
                ref={setNub(leftNubs, header)}
                onPointerDown={(e) => startDrag(header, e)}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <div className={styles.column}>
        <span className={styles.columnHead}>The Chain</span>
        {spec.fields.map((field) => (
          <FieldPort
            key={field.key}
            field={field}
            mappedHeader={headerForField(field.key)}
            armed={armed !== null}
            hovered={hoverField === field.key}
            setNubRef={setNub(rightNubs, field.key)}
            onEnter={() => drag && setHoverField(field.key)}
            onLeave={() => setHoverField((f) => (f === field.key ? null : f))}
            onClick={() => clickField(field.key)}
            onUnwire={() => unwire(field.key)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldPort({
  field,
  mappedHeader,
  armed,
  hovered,
  setNubRef,
  onEnter,
  onLeave,
  onClick,
  onUnwire,
}: {
  field: CanonicalFieldSpec;
  mappedHeader: string | null;
  armed: boolean;
  hovered: boolean;
  setNubRef: (el: HTMLElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  onUnwire: () => void;
}): ReactNode {
  const missing = field.required && !mappedHeader;
  return (
    <div
      className={`${styles.port} ${styles.portRight} ${hovered ? styles.portHover : ''} ${missing ? styles.portMissing : ''}`}
      data-missing={missing || undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span className={styles.nubLeft} ref={setNubRef} aria-hidden="true" />
      <button type="button" className={styles.fieldMain} onClick={onClick} disabled={!armed}>
        <span className={styles.portName}>
          {field.label}
          {field.required ? <span className={styles.req}>required</span> : null}
        </span>
        {mappedHeader ? (
          <span className={styles.mappedChip}>{mappedHeader}</span>
        ) : (
          <span className={styles.portSample}>{field.hint ?? 'Unmapped'}</span>
        )}
      </button>
      {mappedHeader ? (
        <button
          type="button"
          className={styles.unwire}
          onClick={onUnwire}
          aria-label={`Unmap ${field.label}`}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

// ----- helpers -----

function setNub(store: React.RefObject<Map<string, HTMLElement>>, key: string) {
  return (el: HTMLElement | null) => {
    if (el) store.current.set(key, el);
    else store.current.delete(key);
  };
}

function dragOrigin(
  el: HTMLElement | undefined,
  container: HTMLElement | null,
): { x: number; y: number } | null {
  if (!el || !container) return null;
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { x: r.right - c.left, y: r.top - c.top + r.height / 2 };
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, (x2 - x1) * 0.4);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
