import type { ReactNode } from 'react';

/**
 * ChainGlyph — the brand mark: three interlocking links, the last one cobalt.
 * This is cobalt allotment slot "brand-mark glyph" (MASTER_PROMPT). Inherits
 * `currentColor` for the neutral links; the lit link uses the cobalt token.
 */
export function ChainGlyph({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="The Chain"
      style={{ display: 'block' }}
    >
      <rect x="2.5" y="8.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7.5" y="8.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="12.5"
        y="8.5"
        width="9"
        height="7"
        rx="1.5"
        stroke="var(--color-signal)"
        strokeWidth="1.6"
      />
    </svg>
  );
}
