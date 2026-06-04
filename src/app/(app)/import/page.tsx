import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { getKindSpec } from '@/lib/import/field-specs';
import { ImportFlow } from './ImportFlow';

export const metadata = { title: 'Import · The Chain' };

/**
 * Import — CSV ingestion (Block 5). Server Component: hands the product import
 * spec to the client flow (upload → map → preview → commit). Wave 5.1 drives the
 * product kind; suppliers + sales/movements join as additional tabs in 5.2.
 */
export default function ImportPage(): ReactNode {
  const productSpec = getKindSpec('product');

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Ingestion · bring your catalog in" title="Import" />
      <ImportFlow spec={productSpec} />
    </div>
  );
}
