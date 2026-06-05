import { describe, expect, it } from 'vitest';
import { decodeCsvBytes } from '@/lib/import/parse';
import { parseOccurredAt } from '@/lib/import/writers-shared';

/**
 * Encoding detection + strict date parsing (Block 5 ticket cleanup).
 */

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe('decodeCsvBytes', () => {
  it('decodes valid UTF-8 as-is', () => {
    const utf8 = new TextEncoder().encode('Café, São Paulo');
    expect(decodeCsvBytes(utf8.buffer)).toBe('Café, São Paulo');
  });

  it('falls back to Windows-1252 for invalid UTF-8 (legacy Excel export)', () => {
    // "Café" with é as the single Windows-1252 byte 0xE9 — invalid UTF-8 alone.
    expect(decodeCsvBytes(bytes(0x43, 0x61, 0x66, 0xe9))).toBe('Café');
  });

  it('decodes high accented bytes that mojibake under UTF-8 (ñ, ü)', () => {
    // "Piñata Süd" with ñ=0xF1 and ü=0xFC — the common Excel-export case.
    expect(decodeCsvBytes(bytes(0x50, 0x69, 0xf1, 0x61, 0x74, 0x61, 0x20, 0x53, 0xfc, 0x64))).toBe(
      'Piñata Süd',
    );
  });
});

describe('parseOccurredAt', () => {
  it('accepts ISO and US date formats', () => {
    expect(parseOccurredAt('2026-03-15')).toBe('2026-03-15T00:00:00.000Z');
    expect(parseOccurredAt('3/15/2026')).not.toBeNull();
    expect(parseOccurredAt(' 2026-03-15T10:30:00Z ')).toBe('2026-03-15T10:30:00.000Z');
  });

  it('rejects bare numbers a loose Date would misread', () => {
    expect(parseOccurredAt('5')).toBeNull();
    expect(parseOccurredAt('20260315')).toBeNull();
  });

  it('rejects garbage and out-of-window years', () => {
    expect(parseOccurredAt('not a date')).toBeNull();
    expect(parseOccurredAt('1850-01-01')).toBeNull();
    expect(parseOccurredAt('')).toBeNull();
  });
});
