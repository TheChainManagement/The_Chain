'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { NAV_ITEMS } from '@/lib/modes/nav';
import type { OperatingProfile } from '@/lib/modes/types';
import styles from './bench-rails.module.css';

/**
 * LeftRail — bench navigation. Client component for the active-route highlight
 * (the single cobalt selected state for the rail region). Sign-out posts the
 * server action. W2-0: the layout resolves the tenant's operating profile and
 * passes it in; the rail fits nav labels (and, later, which items show) and
 * surfaces a mode badge under the brand.
 */

export function LeftRail({
  userEmail,
  profile,
  locations = [],
}: {
  userEmail: string;
  profile: OperatingProfile;
  locations?: { id: string; name: string; isPrimary: boolean }[];
}): ReactNode {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedLocation = searchParams.get('location');
  const validSelection = locations.some((location) => location.id === selectedLocation)
    ? (selectedLocation ?? '')
    : '';
  const scopedHref = (href: string): string => {
    if (!validSelection) return href;
    return `${href}?location=${encodeURIComponent(validSelection)}`;
  };
  const items = NAV_ITEMS.filter((item) => !profile.hiddenNav.includes(item.href)).map((item) => ({
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

      {locations.length > 1 ? (
        <label className={styles.locationScope}>
          <span>Location scope</span>
          <select
            aria-label="Location scope"
            value={validSelection}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams.toString());
              if (event.target.value) next.set('location', event.target.value);
              else next.delete('location');
              const query = next.toString();
              router.replace(query ? `${pathname}?${query}` : pathname);
            }}
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.isPrimary ? ' · Primary' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className={styles.nav}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={scopedHref(item.href)}
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
