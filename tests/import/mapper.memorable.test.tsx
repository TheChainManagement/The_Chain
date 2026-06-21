// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ColumnMapper } from '@/app/(app)/import/ColumnMapper';
import { getKindSpec } from '@/lib/import/field-specs';
import { autoMap, type ColumnMapping } from '@/lib/import/mapping';

/**
 * Block 5 memorable-element artifact (FEATURES.md "required visible artifact:
 * the mapping screen with cobalt connector lines"). Renders the pegboard and
 * asserts the connectors draw + the tactile click-to-connect rewiring works.
 * jsdom has no ResizeObserver / layout, so geometry is zeroed — the connector
 * <path> elements still render, which is what we assert.
 */

const spec = getKindSpec('product');
const sample = {
  'Item Number': 'AB-1',
  'Product Name': 'Widget',
  UOM: 'each',
  Status: 'active',
  Color: 'blue',
};

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('ColumnMapper — the memorable pegboard', () => {
  it('opens pre-wired: an auto-mapped CSV draws one cobalt connector per match', () => {
    const headers = ['Item Number', 'Product Name', 'UOM', 'Status', 'Color'];
    const mapping = autoMap(headers, spec); // wires sku, name, unitOfMeasure, status (4)
    const { container } = render(
      <ColumnMapper
        spec={spec}
        headers={headers}
        sampleRow={sample}
        mapping={mapping}
        onChange={vi.fn()}
      />,
    );
    // The connector lines ARE the memorable element.
    expect(container.querySelectorAll('svg path')).toHaveLength(4);
  });

  it('flags a required field with no column wired', () => {
    const headers = ['Product Name', 'Color']; // no SKU column
    const mapping = autoMap(headers, spec);
    const { container } = render(
      <ColumnMapper
        spec={spec}
        headers={headers}
        sampleRow={sample}
        mapping={mapping}
        onChange={vi.fn()}
      />,
    );
    // SKU is required and unmapped -> a missing port exists.
    expect(container.querySelector('[data-missing]')).not.toBeNull();
  });

  it('rewires by click-to-connect (arm a column, then pick a field)', async () => {
    const headers = ['Item Number', 'Product Name', 'Color'];
    const mapping: ColumnMapping = autoMap(headers, spec);
    // Description starts unmapped; we wire "Color" -> Description.
    expect(mapping.description).toBeNull();

    const onChange = vi.fn();
    render(
      <ColumnMapper
        spec={spec}
        headers={headers}
        sampleRow={sample}
        mapping={mapping}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Color/ }));
    await userEvent.click(screen.getByRole('button', { name: /Description/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ description: 'Color' });
  });
});
