import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { locationHref } from '@/lib/locations/href';
import { resolveLocationScope } from '@/lib/locations/scope';
import { COVERAGE_DAYS } from '@/lib/policy/derive';
import { dosTone, riskTone } from '@/lib/policy/queries';
import { listPolicies, loadWhatIfInputs } from '@/lib/policy/whatif';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './policy.module.css';
import { WhatIfBench } from './WhatIfBench';

export const metadata = { title: 'Policy Bench · The Chain' };

/**
 * The policy what-if bench (Block 9). Top: the selected SKU's three levers +
 * the ticking policy ribbon (the block's memorable element). Below: the policy
 * ledger, thinnest cover first, each row re-aiming the bench via ?product=.
 */
export default async function PolicyBenchPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; location?: string }>;
}): Promise<ReactNode> {
  const { product, location } = await searchParams;
  const supabase = await createSupabaseServer();
  const locationId = await resolveLocationScope(supabase, location);

  const ledger = await listPolicies(supabase, locationId);
  const selectedId = product ?? ledger[0]?.productId ?? null;
  const selectedLocation = product ? locationId : ledger[0]?.locationId;
  const inputs = selectedId
    ? await loadWhatIfInputs(supabase, selectedId, COVERAGE_DAYS, selectedLocation ?? undefined)
    : null;
  const selected = ledger.find((r) => r.productId === selectedId) ?? null;
  const skuCount = new Set(ledger.map((r) => r.productId)).size;
  const multiLocation = ledger.length > skuCount;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Inventory · what-if" title="Policy bench" />

      {ledger.length === 0 ? (
        <Panel
          prefix="Policy"
          title="Nothing to work yet"
          empty
          emptyMessage="Policies derive from promoted forecasts and supplier lead times. Run the forecast batch, then come back."
        />
      ) : (
        <>
          {inputs ? (
            <Panel
              prefix="What-if"
              title={`${inputs.sku} · ${inputs.name}${multiLocation ? ` · ${inputs.locationName}` : ''}`}
              actions={
                <Link
                  href={locationHref(`/inventory/${inputs.productId}`, locationId)}
                  className={styles.skuLink}
                >
                  SKU page →
                </Link>
              }
            >
              <WhatIfBench key={inputs.productId} inputs={inputs} />
            </Panel>
          ) : selected ? (
            <Panel
              prefix="What-if"
              title={`${selected.sku} · ${selected.name}`}
              error
              errorMessage="This policy's backing forecast is missing its bands — recompute the forecast first."
            />
          ) : null}

          <Panel
            prefix="Coverage"
            title={
              multiLocation
                ? `${ledger.length} policies across ${skuCount} SKUs`
                : `${ledger.length} SKUs under policy`
            }
          >
            <ul className={styles.ledger}>
              {ledger.map((row) => (
                <li key={`${row.productId}:${row.locationId}`}>
                  <Link
                    href={`/inventory/policy?product=${row.productId}&location=${row.locationId}`}
                    className={styles.ledgerRow}
                    data-selected={
                      (row.productId === selectedId &&
                        (!inputs || row.locationId === inputs.locationId)) ||
                      undefined
                    }
                  >
                    <span className={styles.ledgerSku}>{row.sku}</span>
                    <span className={styles.ledgerName}>
                      {row.name}
                      {multiLocation ? (
                        <span className={styles.ledgerLocation}> · {row.locationName}</span>
                      ) : null}
                    </span>
                    <span className={styles.ledgerStat}>
                      <span className={styles.ledgerKey}>DOS</span>
                      <StatNumber
                        value={row.daysOfSupply != null ? row.daysOfSupply.toFixed(1) : null}
                        tone={dosTone(row.daysOfSupply, row.leadTimeDaysUsed)}
                      />
                    </span>
                    <span className={styles.ledgerStat}>
                      <span className={styles.ledgerKey}>RISK</span>
                      <StatNumber
                        value={
                          row.stockoutRisk != null ? (row.stockoutRisk * 100).toFixed(1) : null
                        }
                        unit="%"
                        tone={riskTone(row.stockoutRisk)}
                      />
                    </span>
                    <span className={styles.ledgerStat}>
                      <span className={styles.ledgerKey}>ROP</span>
                      <StatNumber
                        value={row.reorderPoint != null ? row.reorderPoint.toFixed(1) : null}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
