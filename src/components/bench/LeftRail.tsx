'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import styles from './bench-rails.module.css';

/**
 * LeftRail — bench navigation. Client component for the active-route highlight
 * (the single cobalt selected state for the rail region). Sign-out posts the
 * server action.
 */

const NAV = [
  { href: '/today', label: 'Today' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/forecasts', label: 'Forecasts' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/reorder', label: 'Reorder' },
  { href: '/flow', label: 'Flow' },
  { href: '/settings', label: 'Settings' },
] as const;

export function LeftRail({ userEmail }: { userEmail: string }): ReactNode {
  const pathname = usePathname();

  return (
    <nav className={styles.left} aria-label="Primary">
      <Link href="/today" className={styles.brand}>
        <ChainGlyph />
        The Chain
      </Link>

      <div className={styles.nav}>
        {NAV.map((item) => {
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
