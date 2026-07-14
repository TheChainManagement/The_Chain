import Link from 'next/link';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';

export const metadata = { title: 'Settings · The Chain' };

export default function SettingsPage() {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Network · team · plan" title="Settings" />
      <Panel prefix="Network" title="Locations">
        <p>Create physical nodes, choose the default location, and safely archive sites.</p>
        <Link href="/settings/locations">Manage locations</Link>
      </Panel>
      <Panel prefix="Plan" title="Billing">
        <Link href="/settings/billing">Manage billing</Link>
      </Panel>
    </div>
  );
}
