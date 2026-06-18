import type { ReactNode } from 'react';
import pageStyles from '@/components/bench/page.module.css';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import type { OnboardingLink } from '@/lib/onboarding/state';

/**
 * The onboarding chain — the memorable element (Block 2). The same five links
 * the sign-up morph ignites (Account → Source → Catalog → Suppliers → Forecast)
 * persist here and light cobalt one by one as the operator completes each step.
 * By the time they reach /today they already know the chain metaphor.
 *
 * Presentational: ChainLink owns the ignite motion. The connector into and
 * between done links fires cobalt; everything ahead waits pewter.
 */
export function OnboardingChain({ links }: { links: OnboardingLink[] }): ReactNode {
  return (
    <section className={pageStyles.chain} aria-label="Onboarding progress">
      {links.map((link, i) => {
        const isLast = i === links.length - 1;
        const connector = isLast ? 'none' : link.state === 'done' ? 'cobalt' : 'pewter';
        return (
          <ChainLink
            key={link.key}
            step={link.step}
            label={link.label}
            state={link.state}
            connector={connector}
          />
        );
      })}
    </section>
  );
}
