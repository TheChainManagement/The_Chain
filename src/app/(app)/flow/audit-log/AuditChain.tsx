'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { AuditEventView } from '@/lib/audit/queries';
import { entityLabel, type RetentionTier } from '@/lib/audit/transform';
import styles from './audit-log.module.css';

/**
 * The audit chain — Block 14a's memorable element.
 *
 * Every change to the tenant renders as one link in a continuous vertical chain
 * of events: a 1px hairline spine threads top to bottom, a node sits on the
 * spine for each entry, and today's entries carry a filled deep-slate node (the
 * "you are here" marker). Each link is a typeset block — mono timestamp, actor,
 * verb + entity — and clicking it expands the before/after field diff inline.
 * Same chain metaphor as the PO lifecycle, turned vertical and made the record.
 */

export interface AuditChainProps {
  events: AuditEventView[];
  entityTypes: string[];
  activeEntity: string;
  windowLabel: string;
  olderExists: boolean;
  /** The window holds more than this page; the UI says so and points at the CSV. */
  capped: boolean;
  tier: RetentionTier;
}

function formatStamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${month} ${day}`, time: `${hh}:${mm}` };
}

export function AuditChain({
  events,
  entityTypes,
  activeEntity,
  windowLabel,
  olderExists,
  capped,
  tier,
}: AuditChainProps): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <StatNumber value={events.length} label="EVENTS" size="panel" />
          <span className={styles.window}>
            Showing <strong>{windowLabel}</strong> of history
          </span>
        </div>
        <a
          className={styles.download}
          href="/api/exports/audit/window.csv"
          data-testid="audit-export"
        >
          Download CSV →
        </a>
      </div>

      <nav className={styles.filters} aria-label="Filter by record type">
        <FilterChip label="All" target="all" active={activeEntity === 'all'} />
        {entityTypes.map((t) => (
          <FilterChip key={t} label={entityLabel(t)} target={t} active={activeEntity === t} />
        ))}
      </nav>

      {events.length === 0 ? (
        <p className={styles.empty}>
          No changes recorded in this window yet. Every edit to a product, supplier, order, or stock
          level lands here as its own link in the chain.
        </p>
      ) : (
        <ol className={styles.chain} data-testid="audit-chain">
          {events.map((e) => {
            const stamp = formatStamp(e.occurredAt);
            const open = openId === e.id;
            const canExpand = e.fields.length > 0;
            return (
              <li
                key={e.id}
                className={styles.entry}
                data-today={e.isToday}
                data-testid="audit-entry"
              >
                <span className={styles.node} data-today={e.isToday} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.block}
                  onClick={() => canExpand && setOpenId(open ? null : e.id)}
                  aria-expanded={canExpand ? open : undefined}
                  data-expandable={canExpand}
                >
                  <span className={styles.stamp}>
                    <span className={styles.stampDate}>{stamp.date}</span>
                    <span className={styles.stampTime}>{stamp.time}</span>
                  </span>
                  <span className={styles.event}>
                    <span className={styles.headline}>
                      <span className={styles.verb} data-verb={e.verb}>
                        {e.verb}
                      </span>{' '}
                      <span className={styles.entity}>{e.entityLabel}</span>
                    </span>
                    <span className={styles.meta}>
                      {e.actor}
                      {e.entityId ? (
                        <span className={styles.ref}> · {e.entityId.slice(0, 8)}</span>
                      ) : null}
                      {e.isToday ? <span className={styles.todayTag}>today</span> : null}
                    </span>
                  </span>
                  {canExpand ? (
                    <span className={styles.chevron} data-open={open} aria-hidden="true">
                      {e.fields.length} {e.fields.length === 1 ? 'field' : 'fields'}
                    </span>
                  ) : null}
                </button>

                {open && canExpand ? (
                  <div className={styles.diff} data-testid="audit-diff">
                    {e.fields.map((f) => (
                      <div key={f.key} className={styles.diffRow} data-kind={f.kind}>
                        <span className={styles.diffKey}>{f.key}</span>
                        <span className={styles.diffVals}>
                          {f.before !== null ? (
                            <span className={styles.diffBefore}>{f.before}</span>
                          ) : null}
                          {f.kind === 'changed' ? (
                            <span className={styles.diffArrow}>→</span>
                          ) : null}
                          {f.after !== null ? (
                            <span className={styles.diffAfter}>{f.after}</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {capped ? (
        <p className={styles.capped} data-testid="audit-capped">
          Showing the most recent {events.length} changes in this window. Download the CSV for the
          full record.
        </p>
      ) : null}

      {olderExists ? (
        <div className={styles.upgrade} data-testid="audit-upgrade">
          <span className={styles.upgradeCopy}>
            Older history is kept but tucked behind your <strong>{tier}</strong> retention window (
            {windowLabel}).
          </span>
          <Link href="/settings" className={styles.upgradeCta}>
            Upgrade to see further back →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  target,
  active,
}: {
  label: string;
  target: string;
  active: boolean;
}): ReactNode {
  const href = target === 'all' ? '/flow/audit-log' : `/flow/audit-log?entity=${target}`;
  return (
    <Link
      href={href}
      className={styles.chip}
      data-active={active}
      aria-current={active ? 'true' : undefined}
      scroll={false}
    >
      {label}
    </Link>
  );
}
