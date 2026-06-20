import type { Metadata } from 'next';
import { TrialCta } from '../TrialCta';
import styles from './how-it-works.module.css';

export const metadata: Metadata = {
  title: 'How it works — The Chain',
  description:
    'Four links, one chain. Connect QuickBooks, see a real forecast, reorder with proof, and close the loop on every PO.',
};

const STAGES = [
  {
    n: '01',
    name: 'Connect',
    summary: 'Link QuickBooks Online in minutes.',
    body: 'The Chain reads your catalog, suppliers, and purchase history, then keeps syncing both ways. No CSV gymnastics, no migration project, no rip-and-replace.',
  },
  {
    n: '02',
    name: 'Forecast',
    summary: 'See real demand, not a guess.',
    body: 'Every SKU gets a statistical forecast, scored against a baseline so you know which numbers to trust and which to watch. The math is the source of truth — Claude only explains it.',
  },
  {
    n: '03',
    name: 'Reorder',
    summary: 'Order with proof.',
    body: 'Defensible reorder points, safety stock, and supplier scorecards turn "I think we’re low" into a purchase order you can defend. One click sends it to the supplier.',
  },
  {
    n: '04',
    name: 'Receive',
    summary: 'Close the loop.',
    body: 'Track every PO from supplier to received. Stock updates itself, the chain advances link by link, and the next forecast gets smarter from what just happened.',
  },
] as const;

/**
 * How it works (Block 17b). Sequential scroll with sticky-stacked sections: each
 * stage pins to the top and the next sheet slides up over it, so the page
 * physically stacks Connect → Forecast → Reorder → Receive as you scroll. The
 * mini chain at the top of each sheet advances its lit link to match the stage —
 * the chain motif at smaller scale. Editorial, no bench.
 */
export default function HowItWorks() {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>How it works</span>
        <h1 className={styles.h1}>Four links. One chain.</h1>
        <p className={styles.lede}>
          From the supplier to your shelf, The Chain runs one connected loop — and every trip around
          it makes the next one sharper. Scroll to walk the chain.
        </p>
      </header>

      <div className={styles.stack}>
        {STAGES.map((s, i) => (
          <section key={s.name} className={styles.stage} data-testid="stage">
            <div className={styles.stageInner}>
              <div className={styles.miniChain} aria-hidden="true">
                {STAGES.map((m, j) => (
                  <span key={m.name} className={styles.miniLink} data-active={j === i}>
                    {m.name}
                  </span>
                ))}
              </div>
              <span className={styles.num}>
                {s.n} <span className={styles.numTotal}>/ 04</span>
              </span>
              <h2 className={styles.stageName}>{s.name}</h2>
              <p className={styles.summary}>{s.summary}</p>
              <p className={styles.body}>{s.body}</p>
            </div>
          </section>
        ))}
      </div>

      <div className={styles.cta}>
        <TrialCta className={styles.ctaPrimary} location="how_it_works">
          Start 14-day trial
        </TrialCta>
        <a href="/pricing" className={styles.ctaSecondary}>
          See pricing →
        </a>
      </div>
    </div>
  );
}
