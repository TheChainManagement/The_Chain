'use client';

import { type ReactNode, useState } from 'react';
import { resolveUomCode, uomOptionGroups } from '@/lib/uom/units';
import styles from './UomPicker.module.css';

/**
 * UomPicker (W2-1b) — a curated unit-of-measure dropdown with an "Other" escape
 * hatch. Submits a single `unit_of_measure` value via a hidden input, so it drops
 * into any FormData server-action form. The host owns the <label>; the picker
 * takes the host's input `className` so it matches the surrounding fields.
 *
 * Stored value is the curated code (e.g. "ea") or the operator's custom text;
 * the column stays free-form, so legacy/custom values are always valid.
 */

const OTHER = '__other__';

export function UomPicker({
  name = 'unit_of_measure',
  defaultValue = '',
  className,
}: {
  name?: string;
  defaultValue?: string;
  className?: string;
}): ReactNode {
  // Resolve a default (code, alias, or legacy free-text) to a curated code so an
  // existing "each" record snaps to "Each", not the Other field.
  const matched = resolveUomCode(defaultValue);
  const [selected, setSelected] = useState(defaultValue === '' ? '' : (matched ?? OTHER));
  const [custom, setCustom] = useState(matched || defaultValue === '' ? '' : defaultValue);

  const effective = (selected === OTHER ? custom : selected).trim();

  return (
    <div className={styles.wrap}>
      <select
        className={className}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Unit of measure"
      >
        <option value="">Select a unit…</option>
        {uomOptionGroups().map((group) => (
          <optgroup key={group.category} label={group.category}>
            {group.options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label} ({o.code})
              </option>
            ))}
          </optgroup>
        ))}
        <option value={OTHER}>Other…</option>
      </select>

      {selected === OTHER ? (
        <input
          className={className}
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Custom unit, e.g. spool"
          aria-label="Custom unit of measure"
          autoComplete="off"
        />
      ) : null}

      <input type="hidden" name={name} value={effective} />
    </div>
  );
}
