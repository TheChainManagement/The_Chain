'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { NumberRoll } from '@/components/NumberRoll/NumberRoll';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { InsightView } from '@/lib/insights/generate';
import { clampServiceLevel, SERVICE_LEVEL_MAX, SERVICE_LEVEL_MIN } from '@/lib/policy/compute';
import { dosTone, riskTone } from '@/lib/policy/queries';
import { deriveScenario, type WhatIfInputs } from '@/lib/policy/whatif';
import { explainWhatIf, savePolicyDefault } from './actions';
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

  const { supplier, effectiveLead, policy } = useMemo(
    () => deriveScenario(inputs, { serviceLevel, supplierId, leadOverride }),
    [inputs, serviceLevel, supplierId, leadOverride],
  );
  const baseLead = supplier?.leadTimeDays ?? null;

  // The saved policy, re-derived by the SAME engine — so the baseline numbers
  // the insight cites as "from" are visible on the bench, never unverifiable.
  const baseline = useMemo(
    () =>
      deriveScenario(inputs, {
        serviceLevel: inputs.serviceLevel,
        supplierId: inputs.primarySupplierId,
        leadOverride: null,
      }),
    [inputs],
  );

  const dirty = clampServiceLevel(serviceLevel) !== inputs.serviceLevel;

  // The scenario differs from the saved policy on any lever — that's when an
  // explanation has something to say.
  const scenarioChanged = dirty || leadOverride != null || supplierId !== inputs.primarySupplierId;

  // Claude's read of the current scenario (loaded on demand, not per scrub).
  const [insight, setInsight] = useState<InsightView | null>(null);
  const [insightPhase, setInsightPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [explaining, startExplain] = useTransition();

  // A loaded note describes the scenario it was asked about; clear it the moment
  // any lever moves so a stale read never sits under fresh numbers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on any lever change, not on insight identity
  useEffect(() => {
    setInsight(null);
    setInsightPhase('idle');
  }, [serviceLevel, supplierId, leadOverride]);

  function explain() {
    setInsightPhase('loading');
    startExplain(async () => {
      const res = await explainWhatIf({
        productId: inputs.productId,
        locationId: inputs.locationId,
        serviceLevel,
        supplierId,
        leadOverride,
      });
      if (res.ok) {
        setInsight(res.insight);
        setInsightPhase('idle');
      } else {
        setInsightPhase('error');
      }
    });
  }

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

      {/* Claude's read of the trade-off — on demand, never per scrub. */}
      {policy != null && scenarioChanged ? (
        <div className={styles.whatifExplain}>
          {baseline.policy != null ? (
            <span className={styles.baselineRef}>
              Saved · {(inputs.serviceLevel * 100).toFixed(1)}% · safety stock{' '}
              {baseline.policy.safetyStock.toFixed(1)} · reorder point{' '}
              {baseline.policy.reorderPoint.toFixed(1)}
            </span>
          ) : null}
          {insight ? (
            <>
              <ClaudeInsight topic="if you do this" confidence={insight.confidence}>
                {insight.content}
              </ClaudeInsight>
              <span className={styles.whatifCaption}>
                {insight.model} · prompt {insight.promptVersion}
                {insight.cached ? ' · cached' : ''}
              </span>
            </>
          ) : insightPhase === 'loading' ? (
            <ClaudeInsight topic="if you do this" loading />
          ) : insightPhase === 'error' ? (
            <ClaudeInsight topic="if you do this" error />
          ) : (
            <button
              type="button"
              className={styles.explainBtn}
              onClick={explain}
              disabled={explaining}
            >
              Explain this what-if
            </button>
          )}
        </div>
      ) : null}

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
