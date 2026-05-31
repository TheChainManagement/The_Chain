import { BenchStub } from '@/components/bench/BenchStub';

export const metadata = { title: 'Inventory · The Chain' };

export default function InventoryPage() {
  return (
    <BenchStub
      eyebrow="On-hand, allocated, in transit"
      title="Inventory"
      prefix="Inventory"
      message="On-hand by location, ABC/XYZ classification, and cycle counts arrive once a source is connected."
    />
  );
}
