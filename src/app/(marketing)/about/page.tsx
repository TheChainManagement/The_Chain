import type { Metadata } from 'next';
import { ChainCtaBand } from '../ChainCtaBand';
import styles from '../editorial.module.css';

export const metadata: Metadata = {
  title: 'About — The Chain',
  description:
    'The Chain gives small and mid-size B2B distributors the inventory math that used to belong only to the big operators. Built by More Technologies on QuickBooks.',
};

// The loop the product is named for — supplier to shelf, shown as the chain.
const FLOW = ['Supplier', 'Order', 'Transit', 'Receipt', 'Shelf'] as const;

/**
 * About (Block 17c, premium re-cut). Small, on-direction: the why behind the
 * product, now carrying the chain motif (the supplier→shelf loop it's named for)
 * and the shared steel-chain CTA band. Editorial, no bench.
 */
export default function About() {
  return (
    <>
      <div className={styles.page}>
        <header className={styles.intro}>
          <span className={styles.eyebrow}>About</span>
          <h1 className={styles.h1}>The math the big operators kept to themselves.</h1>
          <p className={styles.lede}>
            Enterprise distributors have had demand forecasting and replenishment software for
            decades. Everyone smaller got a spreadsheet and a gut feeling. The Chain closes that
            gap.
          </p>
        </header>

        <div className={styles.prose}>
          <p>
            Most small and mid-size distributors run their whole operation on{' '}
            <strong>QuickBooks plus instinct</strong>. They over-order and tie up cash in dead
            stock, or under-order and lose the sale on the item that actually moves. The tools that
            fix this were built for operators ten times their size, at prices to match.
          </p>
          <p>
            The Chain reads what’s already in QuickBooks and turns it into a{' '}
            <strong>real statistical forecast</strong>, defensible reorder points, and supplier
            reliability you can see. The numbers come from the model. Claude only explains them, in
            plain language, always cited. Nothing is a black box, and nothing is a guess.
          </p>
          <p>
            We named it The Chain because that’s how the work actually moves — supplier to order to
            transit to receipt to shelf, one connected loop. When you can see the whole chain, you
            stop firefighting and start planning.
          </p>
          <div
            className={styles.flow}
            role="img"
            aria-label="The loop: supplier, order, transit, receipt, shelf."
          >
            {FLOW.map((f, i) => (
              <span
                key={f}
                className={styles.flowLink}
                data-last={i === FLOW.length - 1 ? '' : undefined}
              >
                {f}
              </span>
            ))}
          </div>
          <p>
            The Chain is built by <strong>More Technologies</strong>, an independent software
            company building practical tools for people doing real work.
          </p>
        </div>
      </div>

      <ChainCtaBand
        location="about"
        secondaryHref="/how-it-works"
        secondaryLabel="See how it works →"
      />
    </>
  );
}
