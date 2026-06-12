'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { NumberRoll } from '@/components/NumberRoll/NumberRoll';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import {
  clampServiceLevel,
  derivePolicy,
  SERVICE_LEVEL_MAX,
  SERVICE_LEVEL_MIN,
} from '@/lib/policy/compute';
import { dosTone, riskTone } from '@/lib/policy/queries';
import type { WhatIfInputs } from '@/lib/policy/whatif';
import { savePolicyDefault } from './actions';
import styles from './policy.module.css';

/**
 * The what-if bench (Block 9's memorable element). Three levers — service
 * level, lead time, supplier — and the POLICY RIBBON below them: DOS, reorder
 * point, safety stock, recommended qty, stockout risk, every number ticking
 * with a counter-roll as you scrub. The math is the SAME pure `derivePolicy`
 * the batch runs, executed in the browser over inputs loaded once — scrubbing
 * cannot write; "Save as default" is the explicit commit (service level only;
 * the lead/supplier levers are exploration — supplier changes are made on the
 * SKU page).
 */
export function WhatIfBench({ inputs }: { inputs: WhatIfInputs }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serviceLevel, setServiceLevel] = useState(inputs.serviceLevel);
  const [supplierId, setSupplierId] = useState(inputs.primarySupplierId);
  const [leadOverride, setLeadOverride] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supplier =
    inputs.suppliers.find((s) => s.supplierId === supplierId) ?? inputs.suppliers[0] ?? null;
  const baseLead = supplier?.leadTimeDays ?? null;
  const effectiveLead = leadOverride ?? baseLead;

  const policy = useMemo(() => {
    if (effectiveLead == null) return null;
    return derivePolicy({
      dailyMean: inputs.demand.dailyMean,
      dailySigma: inputs.demand.dailySigma,
      leadTimeDays: effectiveLead,
      leadSigmaDays: leadOverride != null ? 0 : (supplier?.leadSigmaDays ?? 0),
      serviceLevel,
      moq: supplier?.moq ?? null,
      coverageDays: inputs.coverageDays,
      position: inputs.position,
    });
  }, [inputs, serviceLevel, effectiveLead, leadOverride, supplier]);

  const dirty = clampServiceLevel(serviceLevel) !== inputs.serviceLevel;

  function save() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      const res = await savePolicyDefault({
        productId: inputs.productId,
        locationId: inputs.locationId,
        serviceLevel,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote('Saved as the policy default');
      router.refresh();
    });
  }

  return (
    <div className={styles.bench} data-testid="whatif-bench">
      <div className={styles.levers}>
        {/* Lever 1 — service level */}
        <label className={styles.lever}>
          <span className={styles.leverKey}>SERVICE LEVEL</span>
          <input
            type="range"
            className={styles.slider}
            min={SERVICE_LEVEL_MIN * 100}
            max={SERVICE_LEVEL_MAX * 100}
            step={0.5}
            value={serviceLevel * 100}
            onChange={(e) => setServiceLevel(Number(e.target.value) / 100)}
            aria-valuetext={`${(serviceLevel * 100).toFixed(1)} percent`}
          />
          <span className={styles.leverValue}>{(serviceLevel * 100).toFixed(1)}%</span>
        </label>

        {/* Lever 2 — lead time (exploration override) */}
        <label className={styles.lever}>
          <span className={styles.leverKey}>
            LEAD TIME
            {leadOverride != null ? (
              <button
                type="button"
                className={styles.leverReset}
                onClick={() => setLeadOverride(null)}
              >
                reset
              </button>
            ) : null}
          </span>
          <input
            type="range"
            className={styles.slider}
            min={1}
            max={45}
            step={1}
            value={effectiveLead ?? 1}
            onChange={(e) => setLeadOverride(Number(e.target.value))}
            disabled={baseLead == null && leadOverride == null}
            aria-valuetext={`${effectiveLead ?? '—'} days`}
          />
          <span className={styles.leverValue}>
            {effectiveLead != null ? `${effectiveLead} days` : 'no lead time'}
            {leadOverride == null && supplier ? (
              <span className={styles.leverSource}>
                {supplier.leadTimeSource === 'scorecard' ? ' · empirical' : ' · supplier setting'}
              </span>
            ) : (
              <span className={styles.leverSource}> · what-if</span>
            )}
          </span>
        </label>

        {/* Lever 3 — supplier */}
        <fieldset className={styles.lever}>
          <legend className={styles.leverKey}>SUPPLIER</legend>
          <div className={styles.supplierRow}>
            {inputs.suppliers.map((s) => (
              <button
                key={s.supplierId}
                type="button"
                aria-pressed={s.supplierId === supplierId}
                className={styles.supplierChip}
                data-selected={s.supplierId === supplierId || undefined}
                onClick={() => {
                  setSupplierId(s.supplierId);
                  setLeadOverride(null);
                }}
              >
                {s.name}
                {s.leadTimeDays != null ? (
                  <span className={styles.supplierLead}>{s.leadTimeDays}d</span>
                ) : null}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* The ribbon — every number ticks as the levers move. */}
      {policy == null ? (
        <p className={styles.noLead}>
          This supplier has no lead time configured — set one on the SKU page, or scrub the
          lead-time lever to explore.
        </p>
      ) : (
        <div className={styles.ribbon} data-testid="policy-ribbon">
          <div className={styles.ribbonCell}>
            <span className={styles.ribbonKey}>Days of supply</span>
            <NumberRoll signal={policy.daysOfSupply?.toFixed(1) ?? '—'}>
              <StatNumber
                value={policy.daysOfSupply != null ? policy.daysOfSupply.toFixed(1) : null}
                unit="days"
                size="panel"
                tone={dosTone(policy.daysOfSupply, effectiveLead ?? 0)}
              />
            </NumberRoll>
          </div>
          <div className={styles.ribbonCell}>
            <span className={styles.ribbonKey}>Reorder point</span>
            <NumberRoll signal={policy.reorderPoint.toFixed(1)}>
              <StatNumber value={policy.reorderPoint.toFixed(1)} size="panel" />
            </NumberRoll>
          </div>
          <div className={styles.ribbonCell}>
            <span className={styles.ribbonKey}>Safety stock</span>
            <NumberRoll signal={policy.safetyStock.toFixed(1)}>
              <StatNumber value={policy.safetyStock.toFixed(1)} size="panel" />
            </NumberRoll>
          </div>
          <div className={styles.ribbonCell}>
            <span className={styles.ribbonKey}>Recommended qty</span>
            <NumberRoll signal={policy.recommendedOrderQty}>
              <StatNumber value={policy.recommendedOrderQty} size="panel" />
            </NumberRoll>
          </div>
          <div className={styles.ribbonCell}>
            <span className={styles.ribbonKey}>Stockout risk</span>
            <NumberRoll signal={policy.stockoutRisk?.toFixed(4) ?? '—'}>
              <StatNumber
                value={policy.stockoutRisk != null ? (policy.stockoutRisk * 100).toFixed(1) : null}
                unit="%"
                size="panel"
                tone={riskTone(policy.stockoutRisk)}
              />
            </NumberRoll>
          </div>
        </div>
      )}

      <div className={styles.benchFoot}>
        <span className={styles.benchNote}>
          Scrubbing writes nothing. Save commits the service level; supplier and lead-time moves
          here are exploration — make them real on the SKU page.
        </span>
        <div className={styles.benchActions}>
          {note ? <span className={styles.saveNote}>{note}</span> : null}
          {error ? (
            <span className={styles.saveError} role="alert">
              {error}
            </span>
          ) : null}
          <ActionButton variant="primary" onClick={save} loading={pending} disabled={!dirty}>
            Save as default
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
