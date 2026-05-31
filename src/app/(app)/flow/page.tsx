import { BenchStub } from '@/components/bench/BenchStub';

export const metadata = { title: 'Flow · The Chain' };

export default function FlowPage() {
  return (
    <BenchStub
      eyebrow="Alerts, audit, connections, conflicts"
      title="Flow"
      prefix="Flow"
      message="Open alerts, the audit trail, source connections, and sync conflicts all stream through here once the chain is live."
    />
  );
}
