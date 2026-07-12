'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { LocationOption } from '@/lib/procurement/queries';
import { createRfq, type RfqActionState } from './actions';
import styles from './procurement.module.css';

/**
 * NewRfq — the bench's create affordance (AddSupplier disclosure idiom). A
 * quote request starts as a titled draft against one location; lines + vendors
 * are worked on the detail bench, so on success we go straight there.
 */

function SubmitRow(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Open the request
    </ActionButton>
  );
}

export function NewRfq({ locations }: { locations: LocationOption[] }): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<RfqActionState, FormData>(createRfq, null);

  useEffect(() => {
    if (state?.ok) {
      router.push(`/procurement/rfqs/${state.rfqId}`);
    }
  }, [state, router]);

  return (
    <div className={styles.addWrap}>
      <ActionButton
        variant={open ? 'secondary' : 'primary'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Cancel' : 'New quote request'}
      </ActionButton>

      {open ? (
        <form action={formAction} className={styles.addForm} noValidate>
          <span className={styles.addEyebrow}>New quote request</span>

          <label className={styles.addField}>
            <span className={styles.addLabel}>Title</span>
            <input
              name="title"
              type="text"
              className={styles.addInput}
              placeholder="Q3 fastener restock"
              autoComplete="off"
              required
            />
          </label>

          <div className={styles.addRow}>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Buying for</span>
              <select
                name="location_id"
                className={styles.addSelect}
                defaultValue={locations[0]?.id}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Respond by</span>
              <input name="respond_by" type="date" className={styles.addInput} autoComplete="off" />
            </label>
          </div>

          {state?.ok === false ? (
            <p className={styles.formError} role="alert">
              {state.error}
            </p>
          ) : null}

          <div className={styles.addActions}>
            <SubmitRow />
          </div>
        </form>
      ) : null}
    </div>
  );
}
