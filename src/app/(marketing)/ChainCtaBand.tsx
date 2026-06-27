import Image from 'next/image';
import styles from './ChainCtaBand.module.css';
import { GetStartedCta } from './GetStartedCta';

/**
 * ChainCtaBand — the closing payoff shared across the marketing pages. The
 * photoreal brushed-steel chain with one cobalt link is composited onto the band
 * with mix-blend (same printed-on-the-bench language as the hero), bleeding off
 * the right; the slogan + trial CTA sit on the left. Ties the whole surface
 * together and pays off "everything is connected" with the literal object.
 */
export function ChainCtaBand({
  location,
  secondaryHref,
  secondaryLabel,
}: {
  location: string;
  secondaryHref: string;
  secondaryLabel: string;
}) {
  return (
    <section className={styles.band} aria-labelledby="cta-band-headline">
      <div className={styles.visual} aria-hidden="true">
        <Image
          src="/marketing/hero-chain-alt.jpg"
          alt=""
          fill
          sizes="(max-width: 880px) 100vw, 60vw"
          className={styles.macro}
        />
      </div>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>
          <span className={styles.dot} />
          One chain, end to end
        </span>
        <h2 id="cta-band-headline" className={styles.h2}>
          Everything is connected.
        </h2>
        <p className={styles.lede}>
          See the whole chain, supplier to shelf, and prove every reorder. Pick the plan that fits
          and start today.
        </p>
        <div className={styles.actions}>
          <GetStartedCta className={styles.ctaPrimary} location={location}>
            Get started
          </GetStartedCta>
          <a href={secondaryHref} className={styles.ctaSecondary}>
            {secondaryLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
