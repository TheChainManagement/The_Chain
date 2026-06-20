import { ImageResponse } from 'next/og';

export const alt = 'The Chain — Everything is connected.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Branded OG card for every marketing route (Block 17c). Deep slate ground, the
 * three-link chain mark with the last link cobalt, the slogan. No external fonts
 * (system sans) so it renders fast and never fails on a missing asset.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#11161C',
        padding: '76px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ width: 34, height: 26, borderRadius: 7, border: '4px solid #54616F' }} />
          <div
            style={{
              width: 34,
              height: 26,
              borderRadius: 7,
              border: '4px solid #54616F',
              marginLeft: -14,
            }}
          />
          <div
            style={{
              width: 34,
              height: 26,
              borderRadius: 7,
              border: '4px solid #1B5BD9',
              marginLeft: -14,
            }}
          />
        </div>
        <div style={{ fontSize: 26, letterSpacing: 6, color: '#9AA3AF', fontWeight: 700 }}>
          THE CHAIN
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ fontSize: 88, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
          Everything is connected.
        </div>
        <div style={{ fontSize: 30, color: '#9AA3AF' }}>
          Forecast-driven reordering for QuickBooks distributors.
        </div>
      </div>
    </div>,
    { ...size },
  );
}
