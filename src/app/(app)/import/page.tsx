import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { getKindSpec } from '@/lib/import/field-specs';
import { ImportWorkbench } from './ImportWorkbench';

export const metadata = { title: 'Import · The Chain' };

/**
 * Import — CSV ingestion (Block 5; W2-1a added the links lane). Server Component:
 * hands the four importable specs to the client workbench (pick a lane → upload →
 * map → preview → commit). Products, suppliers, supplier pricing (product↔supplier
 * links), and sales/movements each share the same kind-driven flow.
 */
export default function ImportPage(): ReactNode {
  const specs = [
    getKindSpec('product'),
    getKindSpec('supplier'),
    getKindSpec('product_supplier'),
    getKindSpec('stock_movement'),
  ];

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Ingestion · bring your operation in" title="Import" />
      <ImportWorkbench specs={specs} />
    </div>
  );
}
