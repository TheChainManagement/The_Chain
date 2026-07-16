'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { DirectRequisitionOption, LocationOption } from '@/lib/procurement/queries';
import { createDirectRequisition, type DirectRequisitionState } from './actions';
import styles from './procurement.module.css';

function SubmitRequisition(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Draft requisition
    </ActionButton>
  );
}

export function NewRequisition({
  locations,
  options,
  selectedLocationId = null,
}: {
  locations: LocationOption[];
  options: DirectRequisitionOption[];
  selectedLocationId?: string | null;
}): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedPair, setSelectedPair] = useState(
    options[0] ? `${options[0].productId}:${options[0].supplierId}` : '',
  );
  const selected = useMemo(
    () => options.find((o) => `${o.productId}:${o.supplierId}` === selectedPair),
    [options, selectedPair],
  );
  const [state, formAction] = useActionState<DirectRequisitionState, FormData>(
    createDirectRequisition,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      const scope = selectedLocationId ? `?location=${encodeURIComponent(selectedLocationId)}` : '';
      router.push(`/procurement/requisitions/${state.requisitionId}${scope}`);
    }
  }, [state, router, selectedLocationId]);

  return (
    <div className={styles.addWrap}>
      <ActionButton
        variant={open ? 'secondary' : 'primary'}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Cancel' : 'New requisition'}
      </ActionButton>
      {open ? (
        <form action={formAction} className={styles.addForm} noValidate>
          <span className={styles.addEyebrow}>Direct requisition</span>
          {options.length === 0 ? (
            <p className={styles.formError}>Link an active SKU to a supplier before drafting.</p>
          ) : (
            <>
              <label className={styles.addField}>
                <span className={styles.addLabel}>SKU and supplier</span>
                <select
                  name="product_supplier"
                  className={styles.addSelect}
                  value={selectedPair}
                  onChange={(event) => setSelectedPair(event.target.value)}
                >
                  {options.map((option) => {
                    const value = `${option.productId}:${option.supplierId}`;
                    return (
                      <option key={value} value={value}>
                        {option.sku} · {option.supplierName}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className={styles.addField}>
                <span className={styles.addLabel}>Buying for</span>
                <select
                  name="location_id"
                  className={styles.addSelect}
                  defaultValue={selectedLocationId ?? locations[0]?.id}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.addRow}>
                <label className={styles.addField}>
                  <span className={styles.addLabel}>
                    Quantity {selected?.purchaseUom ? `(${selected.purchaseUom})` : ''}
                  </span>
                  <input
                    name="qty"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={styles.addInput}
                    required
                  />
                </label>
                <label className={styles.addField}>
                  <span className={styles.addLabel}>Unit cost</span>
                  <input
                    key={selectedPair}
                    name="unit_cost"
                    type="number"
                    min="0"
                    step="0.01"
                    className={styles.addInput}
                    defaultValue={selected?.unitCost ?? ''}
                    required
                  />
                </label>
              </div>
              {selected?.factor ? (
                <span className={styles.addHint}>
                  1 {selected.purchaseUom} = {selected.factor} stock units
                </span>
              ) : null}
              {state?.ok === false ? (
                <p className={styles.formError} role="alert">
                  {state.error}
                </p>
              ) : null}
              <div className={styles.addActions}>
                <SubmitRequisition />
              </div>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}
