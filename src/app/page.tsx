/**
 * Placeholder home page. Phase 5 Foundation will replace this with:
 * - Marketing hero on /(marketing)
 * - Sign-up / sign-in on /(auth)
 * - Working Bench shell on /(app)
 *
 * For now this is a single screen that proves tokens, fonts, and motion are wired.
 */

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--spacing-7)',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ maxWidth: '60ch' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-dim)',
            margin: 0,
            paddingLeft: 'var(--spacing-2)',
            borderLeft: '2px solid var(--color-signal)',
          }}
        >
          The Chain · Foundation in progress
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontVariationSettings: '"wdth" 75',
            fontWeight: 800,
            fontSize: 'clamp(40px, 5.4vw, 68px)',
            lineHeight: 1.04,
            letterSpacing: 0,
            color: 'var(--color-deep)',
            margin: 'var(--spacing-5) 0 var(--spacing-4) 0',
          }}
        >
          Inventory you can prove. Reorders you can defend.
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '18px',
            lineHeight: 1.55,
            color: 'var(--color-mid)',
            margin: '0 0 var(--spacing-6) 0',
          }}
        >
          Phase 5 of the MoreTech process. Foundation scaffold landed. Real app shell + base
          components are next.
        </p>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--color-dim)',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--color-flow)',
            }}
          />
          tokens loaded · fonts loaded · ready to build
        </div>
      </div>
    </main>
  );
}
