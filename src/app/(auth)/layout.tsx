import type { ReactNode } from 'react';

/**
 * (auth) segment layout. No bench, no rails — a single centered surface for
 * sign-in / sign-up / password reset. Shares design tokens with the rest of the
 * app, never the bench chrome (MASTER_PROMPT: marketing/auth and app never share
 * layout chrome).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
