'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { ProductStatus } from '@/lib/inventory/transform';
import { archiveProduct, type ProductActionState, updateProduct } from '../actions';
import formStyles from '../inventory.module.css';
import styles from './detail.module.css';

/**
 * SkuActions — edit + archive affordances in the SKU detail header. Client
 * island. Edit opens the same disclosure form pattern as AddSku (prefilled →
 * updateProduct). Archive is a soft discontinue behind an inline confirm (no
 * modal primitive). Both Server Actions revalidate the detail + list, so the
 * status pill and ledger reflect the change on the next render.
 */

function EditSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Save changes
    </ActionButton>
  );
}

function ArchiveSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" variant="secondary" loading={pending}>
      Archive SKU
    </ActionButton>
  );
}

export function SkuActions({
  productId,
  name,
  unitOfMeasure,
  description,
  status,
}: {
  productId: string;
  name: string;
  unitOfMeasure: string | null;
  description: string | null;
  status: ProductStatus;
}): React.ReactNode {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirmArchive'>('idle');
  const [editState, editAction] = useActionState<ProductActionState, FormData>(updateProduct, null);
  const [archiveState, archiveAction] = useActionState<ProductActionState, FormData>(
    archiveProduct,
    null,
  );
  const editRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editState?.ok) {
      setMode('idle');
    }
  }, [editState]);
  useEffect(() => {
    if (archiveState?.ok) {
      setMode('idle');
    }
  }, [archiveState]);

  const active = status === 'active';

  return (
    <div className={styles.actionsWrap}>
      <div className={styles.actionsRow}>
        <span className={`${styles.statusBadge} ${active ? styles.statusOn : styles.statusOff}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {active ? 'Active' : 'Discontinued'}
        </span>

        <ActionButton
          variant="secondary"
          onClick={() => setMode((m) => (m === 'edit' ? 'idle' : 'edit'))}
          aria-expanded={mode === 'edit'}
        >
          {mode === 'edit' ? 'Cancel' : 'Edit'}
        </ActionButton>

        {active ? (
          mode === 'confirmArchive' ? (
            <form action={archiveAction} className={styles.confirmForm}>
              <input type="hidden" name="product_id" value={productId} />
              <span className={styles.confirmText}>Archive?</span>
              <ArchiveSubmit />
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setMode('idle')}
              >
                Keep
              </button>
            </form>
          ) : (
            <ActionButton variant="secondary" onClick={() => setMode('confirmArchive')}>
              Archive
            </ActionButton>
          )
        ) : null}
      </div>

      {mode === 'edit' ? (
        <form ref={editRef} action={editAction} className={formStyles.addForm} noValidate>
          <input type="hidden" name="product_id" value={productId} />
          <span className={formStyles.addEyebrow}>Edit SKU</span>

          <label className={formStyles.addField}>
            <span className={formStyles.addLabel}>Product name</span>
            <input
              name="name"
              type="text"
              className={formStyles.addInput}
              defaultValue={name}
              autoComplete="off"
              required
            />
          </label>

          <label className={formStyles.addField}>
            <span className={formStyles.addLabel}>Unit of measure</span>
            <input
              name="unit_of_measure"
              type="text"
              className={formStyles.addInput}
              defaultValue={unitOfMeasure ?? ''}
              autoComplete="off"
            />
          </label>

          <label className={formStyles.addField}>
            <span className={formStyles.addLabel}>Description</span>
            <input
              name="description"
              type="text"
              className={formStyles.addInput}
              defaultValue={description ?? ''}
              autoComplete="off"
            />
          </label>

          {editState?.ok === false ? (
            <p className={formStyles.formError} role="alert">
              {editState.error}
            </p>
          ) : null}

          <div className={formStyles.addActions}>
            <EditSubmit />
          </div>
        </form>
      ) : null}
    </div>
  );
}
