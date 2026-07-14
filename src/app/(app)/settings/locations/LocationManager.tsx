'use client';

import { type ReactNode, useActionState } from 'react';
import type { LocationRow } from '@/lib/locations/transform';
import { LOCATION_TYPES } from '@/lib/locations/transform';
import { archiveLocation, createLocation, makePrimary, updateLocation } from './actions';
import styles from './locations.module.css';

function Submit({ children }: { children: ReactNode }) {
  return (
    <button className={styles.button} type="submit">
      {children}
    </button>
  );
}

function Message({ state }: { state: { ok: true } | { ok: false; error: string } | null }) {
  if (!state) return null;
  return (
    <p className={state.ok ? styles.success : styles.error}>{state.ok ? 'Saved.' : state.error}</p>
  );
}

export function AddLocation() {
  const [state, action, pending] = useActionState(createLocation, null);
  return (
    <form action={action} className={styles.addForm}>
      <label>
        Name
        <input name="name" maxLength={120} required placeholder="North warehouse" />
      </label>
      <label>
        Type
        <select name="type" defaultValue="warehouse">
          {LOCATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kind
        <input name="location_kind" maxLength={80} placeholder="stockroom" />
      </label>
      <Submit>{pending ? 'Adding…' : 'Add location'}</Submit>
      <Message state={state} />
    </form>
  );
}

export function LocationCard({ row }: { row: LocationRow }) {
  const [editState, editAction, editing] = useActionState(updateLocation, null);
  const [primaryState, primaryAction, primaryPending] = useActionState(makePrimary, null);
  const [archiveState, archiveAction, archiving] = useActionState(archiveLocation, null);
  return (
    <article className={`${styles.card} ${row.active ? '' : styles.archived}`}>
      <div className={styles.cardHead}>
        <div>
          <strong>{row.name}</strong>
          <span>
            {row.active ? 'Active' : 'Archived'}
            {row.isPrimary ? ' · Primary' : ''}
          </span>
        </div>
      </div>
      <form action={editAction} className={styles.editForm}>
        <input type="hidden" name="location_id" value={row.id} />
        <label>
          Name
          <input
            name="name"
            defaultValue={row.name}
            maxLength={120}
            required
            disabled={!row.active}
          />
        </label>
        <label>
          Type
          <select name="type" defaultValue={row.type} disabled={!row.active}>
            {LOCATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <input
            name="location_kind"
            defaultValue={row.locationKind ?? ''}
            maxLength={80}
            disabled={!row.active}
          />
        </label>
        {row.active ? <Submit>{editing ? 'Saving…' : 'Save details'}</Submit> : null}
        <Message state={editState} />
      </form>
      {row.active ? (
        <div className={styles.actions}>
          {!row.isPrimary ? (
            <form action={primaryAction}>
              <input type="hidden" name="location_id" value={row.id} />
              <Submit>{primaryPending ? 'Switching…' : 'Make primary'}</Submit>
              <Message state={primaryState} />
            </form>
          ) : null}
          <form action={archiveAction}>
            <input type="hidden" name="location_id" value={row.id} />
            <button
              className={styles.archiveButton}
              type="submit"
              disabled={row.isPrimary || archiving}
            >
              {archiving ? 'Archiving…' : 'Archive'}
            </button>
            <Message state={archiveState} />
          </form>
        </div>
      ) : null}
    </article>
  );
}
