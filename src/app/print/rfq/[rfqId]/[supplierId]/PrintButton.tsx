'use client';

import { ActionButton } from '@/components/ActionButton/ActionButton';

/** The one interactive element on the print sheet; hidden by print media. */
export function PrintButton(): React.ReactNode {
  return <ActionButton onClick={() => window.print()}>Print this sheet</ActionButton>;
}
