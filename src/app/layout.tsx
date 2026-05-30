import type { Metadata } from 'next';
import { Mona_Sans, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * next/font/google for zero-CLS, self-hosted font loading.
 * - Mona Sans: variable display font; we use the width axis (wdth) as the
 *   typographic signature per DESIGN_DIRECTION.md (wdth 75 hero, 80 labels,
 *   125 PO identifiers). `axes: ['wdth']` exposes the wdth axis.
 * - IBM Plex Sans: body. Discrete weights 400/500/600/700.
 * - IBM Plex Mono: every consequential number per VISUAL_DENSITY 7.
 * Each binds a CSS variable; globals.css references them as --font-display etc.
 */
const monaSans = Mona_Sans({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['wdth'],
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'The Chain — Inventory you can prove. Reorders you can defend.',
  description:
    'AI-driven supply chain for small-to-mid B2B distributors. Connect QuickBooks Online, watch every PO advance link by link, and stop running stock on instinct.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang='en'
      className={`${monaSans.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
