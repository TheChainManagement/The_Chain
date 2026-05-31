import Link from 'next/link';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { AuthForm } from '../AuthForm';
import styles from '../auth.module.css';

export const metadata = { title: 'Create your workshop · The Chain' };

export default function SignUpPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <ChainGlyph />
          THE CHAIN
        </span>
        <div className={styles.heading}>
          <h1 className={styles.title}>Set up your workshop</h1>
          <p className={styles.sub}>
            Fourteen-day trial. Connect QuickBooks later. Start proving your inventory today.
          </p>
        </div>

        <AuthForm mode="signup" />

        <p className={styles.alt}>
          Already have a workshop?{' '}
          <Link href="/signin" className={styles.altLink}>
            Sign in
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
