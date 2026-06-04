// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ImportWorkbench } from '@/app/(app)/import/ImportWorkbench';
import { getKindSpec } from '@/lib/import/field-specs';

/**
 * Wave 5.2 memorable-element artifact: the three ingestion lanes. Renders the
 * workbench and asserts the lanes render, the active one carries its lit cobalt
 * rail, and selecting a lane moves the active state (which re-keys the flow).
 * The Server Action is mocked so the upload step mounts without pulling the
 * server-only supabase client into jsdom.
 */

vi.mock('@/app/(app)/import/actions', () => ({ runImport: vi.fn() }));

const specs = [getKindSpec('product'), getKindSpec('supplier'), getKindSpec('stock_movement')];

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('ImportWorkbench — the three ingestion lanes', () => {
  it('renders three lanes with the first selected and its cobalt rail present', () => {
    const { container } = render(<ImportWorkbench specs={specs} />);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    // the lit rail (the memorable cobalt signal) lives on the active lane
    expect(container.querySelector('[role="tab"][data-active="true"] span:last-child')).not.toBeNull();
  });

  it('moves the active lane on click (re-keying the flow)', async () => {
    render(<ImportWorkbench specs={specs} />);
    const products = screen.getByRole('tab', { name: /Products/ });
    const suppliers = screen.getByRole('tab', { name: /Suppliers/ });
    expect(suppliers.getAttribute('aria-selected')).toBe('false');

    await userEvent.click(suppliers);

    expect(suppliers.getAttribute('aria-selected')).toBe('true');
    expect(products.getAttribute('aria-selected')).toBe('false');
  });
});
