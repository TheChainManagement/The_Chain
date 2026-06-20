# Block 17 — Marketing site (Waves 17a + 17b)

Date: 2026-06-20
Scope shipped here: 17a (segment + layout + hero) and 17b (/how-it-works + /pricing).
Wave 17c (/about, /contact, SEO, Lighthouse) deferred.

> This file supersedes the earlier `_reviews/2026-06-20_block17a-marketing-hero.md`,
> which described a first-pass hero (five-link chain + time-axis + metric strip)
> that MG replaced. The hero went through three iterations this session; what
> actually shipped is below.

## What shipped

**17a — segment + layout + hero.** A `/(marketing)` route segment with its own
editorial chrome (no bench, no rails) over the shared design tokens. The hero is a
clean, confident opening — the slogan, the why, the CTA — left-aligned over a
**faded engineering-blueprint background** (`/marketing/bg-blueprint.jpg`, a Codex
render, ~12% with a soft mask) so the page never reads as a flat white screen.
Scroll-progress hairline + signal-scan chrome. **The hero VISUAL is intentionally
deferred** ("work on this further down" — MG): the photoreal chain render was tried
and pulled by MG in favor of the simpler opening; we revisit it later.

**17b — /how-it-works + /pricing.**
- `/how-it-works`: **sequential scroll with sticky-stacked sections** (FEATURES
  spec). Each stage pins to the top and the next sheet slides up over it, stacking
  Connect → Forecast → Reorder → Receive. A mini chain at the top of each sheet
  advances its lit link to match the stage — the chain motif at smaller scale.
- `/pricing`: hairline-ruled tiers, **no card boxes**, tabular Plex Mono prices via
  `<StatNumber>` ($129 Starter / $299 Growth / $599 Pro / Custom Enterprise — MG's
  draft from `docs/PRICING_RESEARCH.md`). Growth marked popular with the single
  cobalt intent (top rule + CTA). Per-tier "History retained" row maps to the audit
  retention tiers (1y / 5y / 10y / Unlimited).
- Nav now carries How it works · Pricing.

**Analytics.** Key-gated PostHog (`src/lib/analytics`) — pageviews on route change +
`trial_start_clicked` per CTA (location-tagged: nav / hero / how_it_works /
pricing_<tier>). MG created the PostHog project; `NEXT_PUBLIC_POSTHOG_KEY` (phc_) is
in `.env.local` and Vercel (Production + Preview). **Live-verified:** init +
config.js load + a `/e/` pageview capture fired to us.i.posthog.com.

### Files
- `src/app/(marketing)/layout.tsx`, `page.tsx`, `marketing.module.css`
- `src/app/(marketing)/MarketingChrome.tsx`, `TrialCta.tsx`
- `src/app/(marketing)/how-it-works/{page.tsx,how-it-works.module.css}`
- `src/app/(marketing)/pricing/{page.tsx,pricing.module.css}`
- `src/lib/analytics/index.ts`
- `public/marketing/bg-blueprint.jpg` (+ unused hero-chain.jpg / -alt / source PNGs, held for the hero revisit)
- Tests: `tests/marketing/{segment-separation,how-it-works,pricing}.test.tsx` + memorable `_reviews/2026-06-20_feature_marketing_hero_memorable.test.tsx`

## Decisions (flag for MG / Codex)
1. **No build-beautiful re-run** — it's the Phase-3 design skill; The Chain's
   DESIGN_DIRECTION is locked, marketing is a declared Phase-6 token-sharing
   surface. Built as a design-system application. No declared skill skipped.
2. **Hero visual deferred** — MG pulled the chain render; the clean opening over the
   faded blueprint is the agreed first pass. Revisit "further down."
3. **Pricing numbers** = MG's own research-backed draft ($129/$299/$599); one-line
   to change.
4. **PostHog key-gated** — no-op without a key; key now set, live-verified.

## Verification
- typecheck clean · biome clean (0 warnings) · `next build` clean (all marketing
  routes static `○`).
- **Full suite 648/648** (+8 marketing: segment-separation 2, how-it-works 2,
  pricing 2, memorable 2).
- craft: only failure is the pre-existing PO-route `#301`-in-comment false-positive.
- **Live (dev :3100):** `/` simplified hero + faded blueprint, no console errors,
  mobile stacks; `/how-it-works` sticky-stack DOM-verified (Forecast pins over
  Connect at scroll, mini-chain advances per stage); `/pricing` 4 tiers + StatNumber
  prices + Growth popular + retention rows; PostHog pageview captured live. No bench
  chrome on any marketing page (segment-separation test).
  - Screenshot note: `preview_screenshot` mis-renders sticky sections mid-scroll
    (re-renders at its own viewport) — DOM probes are the evidence of record there,
    per the standing gotcha.

## Codex round-1 (`_reviews/2026-06-20_block17_marketing.md`) dispositions
- **Fixed:** /how-it-works rebuilt as sticky-stacked sections (was a static list);
  this evidence file corrected (the stale block17a file overclaimed the first hero).
- **Deferred → 17c / tickets:** /about + /contact, OG image + JSON-LD structured
  data, Lighthouse ≥90 proof, Playwright hero-capture (infra-blocked), a dedicated
  retention compare-table (per-tier row stands in for now).
- **Held (standing disposition):** raw-px "tokens only" — house style across the app;
  holistic px→token sweep is the stack-audit ticket.
- **Not defects (MG-directed):** hero visual deferral; pricing literals (MG draft).
