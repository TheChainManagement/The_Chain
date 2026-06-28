'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { getProfile } from '@/lib/modes/profiles';
import type { NavHref, OperatingMode } from '@/lib/modes/types';
import styles from './bench-rails.module.css';

/**
 * LeftRail — bench navigation. Client component for the active-route highlight
 * (the single cobalt selected state for the rail region). Sign-out posts the
 * server action. W2-0: the tenant's operating mode fits nav labels (and, later,
 * which items show) and surfaces a mode badge under the brand.
 */

const NAV: readonly { href: NavHref; label: string }[] = [
  { href: '/today', label: 'Today' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/forecasts', label: 'Forecasts' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/purchase-orders', label: 'Purchase Orders' },
  { href: '/import', label: 'Import' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/reorder', label: 'Reorder' },
  { href: '/flow', label: 'Flow' },
  { href: '/settings', label: 'Settings' },
] as const;

export function LeftRail({
  userEmail,
  mode,
}: {
  userEmail: string;
  mode: OperatingMode;
}): ReactNode {
  const pathname = usePathname();
  const profile = getProfile(mode);
  const items = NAV.filter((item) => !profile.hiddenNav.includes(item.href)).map((item) => ({
    href: item.href,
    label: profile.navLabels[item.href] ?? item.label,
  }));

  return (
    <nav className={styles.left} aria-label="Primary">
      <Link href="/today" className={styles.brand}>
        <ChainGlyph />
        The Chain
      </Link>

      <div className={styles.mode} role="note" aria-label={`Operating mode: ${profile.label}`}>
        <span className={styles.modeLabel}>{profile.label}</span>
        <span className={styles.modeHint}>demand from {profile.demandNoun}</span>
      </div>

      <div className={styles.nav}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.navDot} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className={styles.footer}>
        {userEmail ? <span className={styles.who}>{userEmail}</span> : null}
        <form action={signOut}>
          <button type="submit" className={styles.signout}>
            Close the workshop
          </button>
        </form>
      </div>
    </nav>
  );
}
