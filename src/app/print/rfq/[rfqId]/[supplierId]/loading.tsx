import type { ReactNode } from 'react';

/** Print-sheet loading state: a quiet placeholder, no app chrome. */
export default function RfqPrintLoading(): ReactNode {
  return <main aria-busy="true" aria-label="Preparing the request for quote sheet" />;
}
