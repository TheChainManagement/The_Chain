'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { switchActiveTenant } from '@/app/(app)/tenant-actions';
import { signOut } from '@/app/(auth)/actions';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { type MemberRole, ROLE_PROFILES } from '@/lib/access';
import { NAV_ITEMS } from '@/lib/modes/nav';
import type { OperatingProfile } from '@/lib/modes/types';
import styles from './bench-rails.module.css';

/**
 * LeftRail — bench navigation. Client component for the active-route highlight
 * (the single cobalt selected state for the rail region). Sign-out posts the
 * server action. W2-0: the layout resolves the tenant's operating profile and
 * passes it in; the rail fits nav labels and surfaces a mode badge under the
 * brand. W3-2: it also takes the member role — the rail hides nav the role
 * cannot use (mode hiddenNav ∪ role hiddenNav) and shows the role by identity.
 * Nav hiding is chrome, not authorization: RLS and server-side guards remain the
 * boundary, so a hidden route reached by direct URL still resolves through them.
 */

export function LeftRail({
  userEmail,
  role,
  profile,
  locations = [],
  memberships = [],
  activeTenantId,
}: {
  userEmail: string;
  role: MemberRole;
  profile: OperatingProfile;
  locations?: { id: string; name: string; isPrimary: boolean }[];
  memberships?: { tenantId: string; tenantName: string }[];
  activeTenantId?: string;
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
  // Hide nav the operating mode OR the member role cannot use. Union, not
  // either/or: a warehouse role hides planning/procurement even in a mode that
  // shows them, and a mode hides its own surfaces regardless of role.
  const hidden = new Set<string>([...profile.hiddenNav, ...ROLE_PROFILES[role].hiddenNav]);
  const items = NAV_ITEMS.filter((item) => !hidden.has(item.href)).map((item) => ({
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

      {memberships.length > 1 ? (
        <form action={switchActiveTenant} className={styles.locationScope}>
          <span>Company</span>
          <select
            name="tenant_id"
            aria-label="Active company"
            defaultValue={activeTenantId}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {memberships.map((membership) => (
              <option key={membership.tenantId} value={membership.tenantId}>
                {membership.tenantName}
              </option>
            ))}
          </select>
        </form>
      ) : null}

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
        <div className={styles.identity}>
          {userEmail ? <span className={styles.who}>{userEmail}</span> : null}
          <span className={styles.role}>{ROLE_PROFILES[role].label}</span>
        </div>
        <form action={signOut}>
          <button type="submit" className={styles.signout}>
            Close the workshop
          </button>
        </form>
      </div>
    </nav>
  );
}
