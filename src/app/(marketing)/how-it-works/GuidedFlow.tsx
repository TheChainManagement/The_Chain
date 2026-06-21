'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import styles from './how-it-works.module.css';

/**
 * GuidedFlow — the guided blueprint workbench. The four stages scroll in the
 * center column; a sticky visual on the right re-crops the supply-chain model to
 * the stage in view, and a sticky cobalt chain rail on the left advances its lit
 * link as you go. One persistent visual surface, not four thumbnails. Active
 * stage is tracked with IntersectionObserver (no scroll library), so the rail,
 * the visual crop, and the caption all move together. Reduced-motion degrades to
 * a plain stacked read (CSS un-sticks everything; visuals all show).
 */

type Stage = {
  n: string;
  key: string;
  name: string;
  summary: string;
  body: string;
  metric: string;
  metricLabel: string;
  src: string;
  /** object-position crop into the source render for this stage. */
  pos: string;
  /** cobalt target frame, % box {left,top,w,h} over the visual. */
  frame: { left: string; top: string; w: string; h: string };
};

const STAGES: Stage[] = [
  {
    n: '01',
    key: 'connect',
    name: 'Connect',
    summary: 'Link QuickBooks Online in minutes.',
    body: 'The Chain reads your catalog, suppliers, and purchase history, then keeps syncing both ways. No CSV gymnastics, no migration project, no rip-and-replace.',
    metric: '15 min',
    metricLabel: 'To your first full sync',
    src: '/marketing/TheChainHero1.png',
    pos: '12% 70%',
    frame: { left: '8%', top: '52%', w: '34%', h: '34%' },
  },
  {
    n: '02',
    key: 'forecast',
    name: 'Forecast',
    summary: 'See real demand, not a guess.',
    body: 'Every SKU gets a statistical forecast, scored against a baseline so you know which numbers to trust and which to watch. The math is the source of truth — Claude only explains it.',
    metric: '94.6%',
    metricLabel: 'Median forecast confidence',
    src: '/marketing/bg-blueprint.jpg',
    pos: '52% 56%',
    frame: { left: '30%', top: '40%', w: '40%', h: '32%' },
  },
  {
    n: '03',
    key: 'reorder',
    name: 'Reorder',
    summary: 'Order with proof.',
    body: 'Defensible reorder points, safety stock, and supplier scorecards turn "I think we’re low" into a purchase order you can defend. One click sends it to the supplier.',
    metric: '8.3 days',
    metricLabel: 'Cover at reorder point',
    src: '/marketing/TheChainHero1.png',
    pos: '50% 46%',
    frame: { left: '36%', top: '30%', w: '32%', h: '34%' },
  },
  {
    n: '04',
    key: 'receive',
    name: 'Receive',
    summary: 'Close the loop.',
    body: 'Track every PO from supplier to received. Stock updates itself, the chain advances link by link, and the next forecast gets smarter from what just happened.',
    metric: '47.2%',
    metricLabel: 'Fewer stockouts, year one',
    src: '/marketing/TheChainHero1.png',
    pos: '92% 36%',
    frame: { left: '60%', top: '20%', w: '34%', h: '40%' },
  },
];

export function GuidedFlow() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const els = refs.current.filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) setActive(idx);
          }
        }
      },
      // A thin band across the vertical middle: the stage crossing center wins.
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  const activeStage = (STAGES[active] ?? STAGES[0]) as Stage;

  return (
    <div className={styles.workbench}>
      {/* sticky cobalt chain rail */}
      <ol className={styles.rail} aria-hidden="true">
        {STAGES.map((s, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'pending';
          return (
            <li
              key={s.key}
              className={styles.railLink}
              data-state={state}
              data-last={i === STAGES.length - 1 ? '' : undefined}
            >
              <span className={styles.railNum}>{s.n}</span>
              <span className={styles.railName}>{s.name}</span>
            </li>
          );
        })}
      </ol>

      {/* scrolling stage content (inspection plates) */}
      <div className={styles.stages}>
        {STAGES.map((s, i) => (
          <section
            key={s.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-idx={i}
            data-testid="stage"
            className={styles.stage}
            data-active={i === active}
          >
            <div className={styles.plate}>
              <span className={styles.plateNum}>
                {s.n} <span className={styles.plateTotal}>/ 04</span>
              </span>
              <h2 className={styles.stageName}>{s.name}</h2>
              <p className={styles.summary}>{s.summary}</p>
              <p className={styles.body}>{s.body}</p>
              <div className={styles.metric}>
                <span className={styles.metricValue}>{s.metric}</span>
                <span className={styles.metricLabel}>{s.metricLabel}</span>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* sticky visual — re-crops the model to the active stage */}
      <div className={styles.visualCol}>
        <figure className={styles.visual}>
          {STAGES.map((s, i) => (
            <Image
              key={s.key}
              src={s.src}
              alt=""
              fill
              sizes="(max-width: 980px) 100vw, 50vw"
              className={styles.visualImg}
              data-on={i === active}
              style={{ objectPosition: s.pos }}
            />
          ))}
          <span
            className={styles.target}
            style={{
              left: activeStage.frame.left,
              top: activeStage.frame.top,
              width: activeStage.frame.w,
              height: activeStage.frame.h,
            }}
          />
          <figcaption className={styles.caption}>
            <span className={styles.captionStep}>{activeStage.name}</span>
            <span className={styles.captionMetric}>{activeStage.metric}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
