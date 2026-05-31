import Link from 'next/link';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { AuthForm } from '../AuthForm';
import styles from '../auth.module.css';

export const metadata = { title: 'Sign in · The Chain' };

export default function SignInPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <ChainGlyph />
          THE CHAIN
        </span>
        <div className={styles.heading}>
          <h1 className={styles.title}>Back to the bench</h1>
          <p className={styles.sub}>Open your workshop and pick up where the chain left off.</p>
        </div>

        <AuthForm mode="signin" />

        <p className={styles.alt}>
          No workshop yet?{' '}
          <Link href="/signup" className={styles.altLink}>
            Create one
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
