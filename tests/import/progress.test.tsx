// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressBar } from '@/app/(app)/import/ImportFlow';

/**
 * Wave 5.2-durable memorable element: the live cobalt progress fill a large
 * import shows while the durable workflow runs. The Server Action module is
 * mocked so importing the client component doesn't pull workflow/api into jsdom.
 */

vi.mock('@/app/(app)/import/actions', () => ({
  runImport: vi.fn(),
  getImportProgress: vi.fn(),
}));

describe('ProgressBar — durable import progress', () => {
  it('fills to the processed/total percentage', () => {
    const { container } = render(<ProgressBar processed={1200} total={2500} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('48');
    const fill = container.querySelector('[class*="progressFill"]') as HTMLElement | null;
    expect(fill?.style.width).toBe('48%');
  });

  it('reads 0 before any total is known (preparing)', () => {
    const { container } = render(<ProgressBar processed={0} total={0} />);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '0',
    );
  });
});
