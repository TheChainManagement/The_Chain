// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { UomPicker } from '@/components/UomPicker/UomPicker';

/**
 * UomPicker memorable artifact (W2-1b). The visible delta: a curated unit
 * dropdown replaces the free-text box, with an "Other" escape hatch that reveals
 * a custom field. The single submitted `unit_of_measure` value is asserted via
 * the hidden input so the form contract can't silently regress.
 */

function hiddenValue(container: HTMLElement): string {
  return container.querySelector<HTMLInputElement>('input[name="unit_of_measure"]')?.value ?? '';
}

describe('UomPicker', () => {
  it('submits the selected curated code', async () => {
    const { container } = render(<UomPicker />);
    expect(hiddenValue(container)).toBe(''); // nothing chosen yet
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Unit of measure' }), 'kg');
    expect(hiddenValue(container)).toBe('kg');
  });

  it('reveals a custom field on "Other" and submits the typed value', async () => {
    const { container } = render(<UomPicker />);
    expect(screen.queryByLabelText('Custom unit of measure')).toBeNull();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Unit of measure' }),
      '__other__',
    );
    const custom = screen.getByLabelText('Custom unit of measure');
    await userEvent.type(custom, 'spool');
    expect(hiddenValue(container)).toBe('spool');
  });

  it('preselects a known code from defaultValue', () => {
    const { container } = render(<UomPicker defaultValue="ea" />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('ea');
    expect(hiddenValue(container)).toBe('ea');
  });

  it('snaps a legacy free-text default onto the curated unit (each → Each)', () => {
    const { container } = render(<UomPicker defaultValue="each" />);
    // resolves to the curated code, not the Other escape hatch
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('ea');
    expect(screen.queryByLabelText('Custom unit of measure')).toBeNull();
    expect(hiddenValue(container)).toBe('ea');
  });

  it('opens "Other" with the custom value prefilled for a legacy/custom default', () => {
    const { container } = render(<UomPicker defaultValue="spool" />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('__other__');
    expect((screen.getByLabelText('Custom unit of measure') as HTMLInputElement).value).toBe(
      'spool',
    );
    expect(hiddenValue(container)).toBe('spool');
  });
});
