import type { Metadata } from 'next';
import { ChainCtaBand } from '../ChainCtaBand';
import styles from '../editorial.module.css';

export const metadata: Metadata = {
  title: 'Contact — The Chain',
  description:
    'Talk to the team behind The Chain. Questions about a fit for your distribution operation, Enterprise pricing, or getting started.',
};

const CONTACT_EMAIL = 'markgeorge@moretechnologies.com';

/**
 * Contact (Block 17c, premium re-cut). Honest email channels + the shared
 * steel-chain CTA band. Editorial, no bench. (Resend-backed form deferred.)
 */
export default function Contact() {
  return (
    <>
      <div className={styles.page}>
        <header className={styles.intro}>
          <span className={styles.eyebrow}>Contact</span>
          <h1 className={styles.h1}>Let’s talk.</h1>
          <p className={styles.lede}>
            Wondering if The Chain fits your operation, what Enterprise looks like, or how to get
            moving? We read every message.
          </p>
        </header>

        <div className={styles.channels}>
          <div className={styles.channel}>
            <span className={styles.channelLabel}>Sales &amp; general</span>
            <a className={styles.channelValue} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <span className={styles.channelNote}>
              Tell us a little about what you distribute and how you run inventory today.
            </span>
          </div>
          <div className={styles.channel}>
            <span className={styles.channelLabel}>Already a customer?</span>
            <a
              className={styles.channelValue}
              href={`mailto:${CONTACT_EMAIL}?subject=The%20Chain%20support`}
            >
              {CONTACT_EMAIL}
            </a>
            <span className={styles.channelNote}>
              Put “support” in the subject and we’ll get you unstuck.
            </span>
          </div>
        </div>
      </div>

      <ChainCtaBand location="contact" secondaryHref="/pricing" secondaryLabel="See pricing →" />
    </>
  );
}
