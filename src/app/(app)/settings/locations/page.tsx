import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { listLocations } from '@/lib/locations/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { AddLocation, LocationCard } from './LocationManager';
import styles from './locations.module.css';

export const metadata = { title: 'Locations · The Chain' };

export default async function LocationsPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const locations = await listLocations(supabase);
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Network · physical nodes" title="Locations" />
      <Panel prefix="Add" title="Create a location">
        <AddLocation />
      </Panel>
      <section className={styles.grid} aria-label="Tenant locations">
        {locations.map((row) => (
          <LocationCard key={row.id} row={row} />
        ))}
      </section>
    </div>
  );
}
