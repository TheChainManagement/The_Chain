# Codex Review — block17_marketing
**Date:** 2026-06-20 17:39
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block17_marketing
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The `/(marketing)` surface exists as a separate segment with its own chrome. [`src/app/(marketing)/layout.tsx:15`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/layout.tsx:15>) renders a marketing-only header/footer, and [`tests/marketing/segment-separation.test.tsx:22`](</Users/themoreapp/More Technologies/projects/the-chain/tests/marketing/segment-separation.test.tsx:22>) passed locally with the other marketing tests (`8/8`).
- Scroll chrome and analytics wiring exist. [`src/app/(marketing)/MarketingChrome.tsx:15`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/MarketingChrome.tsx:15>) mounts the signal scan and scroll-progress bar; [`src/lib/analytics/index.ts:19`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/analytics/index.ts:19>) initializes key-gated PostHog pageview/event capture; [`src/app/(marketing)/TrialCta.tsx:12`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/TrialCta.tsx:12>) fires the trial click event.
- `/how-it-works` and `/pricing` are on disk. See [`src/app/(marketing)/how-it-works/page.tsx:43`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/how-it-works/page.tsx:43>) and [`src/app/(marketing)/pricing/page.tsx:87`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/pricing/page.tsx:87>).

## What wasn't done

- The feature’s memorable element was not delivered. The contract says the hero must ship a chain hero with ignite animation and a Playwright capture at `200ms`, `1000ms`, and final state ([`FEATURES.md:670`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:670>), [`FEATURES.md:690`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:690>)). The actual home page explicitly says the hero visual was “intentionally deferred” and renders only copy + CTA over a blueprint background ([`src/app/(marketing)/page.tsx:18`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:18>)-[`23`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:23>), [`29`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:29>)-[`49`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:49>)).
- The memorable-artifact proof was watered down to match the missing hero. [`_reviews/2026-06-20_feature_marketing_hero_memorable.test.tsx:21`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_feature_marketing_hero_memorable.test.tsx:21>)-[`31`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_feature_marketing_hero_memorable.test.tsx:31>) is a jsdom test that checks only the slogan and `hero-bg`. It is not the required Playwright interaction proof, and it proves nothing about chain formation or ignite timing.
- The evidence trail on disk overclaims shipped work. [`_reviews/2026-06-20_block17a-marketing-hero.md:14`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:14>)-[`20`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:20>) claims a five-link hero chain, time-axis ruler, and metric strip. [`src/app/(marketing)/page.tsx:25`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:25>)-[`53`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:53>) contains none of that.
- The feature-level evidence file required by the master prompt is missing. The contract requires `_reviews/<date>_feature_<name>.md` ([`MASTER_PROMPT.md:143`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:143>)). What exists is `_reviews/2026-06-20_block17a-marketing-hero.md`, which does not satisfy that required artifact name.
- The marketing feature is still incomplete against its own block. `FEATURES.md` requires `/about` and `/contact` ([`FEATURES.md:673`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:673>)); there are no corresponding route files under `src/app/(marketing)/`.
- The required Lighthouse proof is absent. The acceptance bar is `Lighthouse Performance ≥ 90 on the hero` ([`FEATURES.md:680`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:680>)), and the existing evidence file still lists Lighthouse as deferred ([`_reviews/2026-06-20_block17a-marketing-hero.md:76`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:76>)-[`77`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:77>)).

## What can be done better

- Stop claiming “tokens only” while hardcoding design values all over the slice. [`MASTER_PROMPT.md:17`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:17>) and [`35`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:35>) ban this. The marketing CSS still hardcodes values like `10px 16px`, `760px`, `11px`, `44px`, `72px`, `13px 22px`, `6px`, `80ms`, `720ms`, `56vh`, and `34ch` in [`src/app/(marketing)/marketing.module.css:20`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:20>), [`52`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:52>), [`106`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:106>), [`138`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:138>), [`177`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:177>), [`196`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:196>), [`224`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/marketing.module.css:224>), and more.
- The evidence discipline is sloppy. The review file says the hero is the demo; the code comments say the hero visual is deferred; the memorable test was rewritten around the weaker reality. That is how review trails become fiction.
- The current hero is generic SaaS copy on a background image. The product’s named visual asset is the chain. If the chain is removed, the page stops selling the product and starts selling a slogan.

## What was missed

- `/how-it-works` does not match its required interaction. The contract calls for a “sequential scroll with sticky-stacked sections” ([`FEATURES.md:671`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:671>)). The implementation is a plain ordered list of four items ([`src/app/(marketing)/how-it-works/page.tsx:55`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/how-it-works/page.tsx:55>)-[`67`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/how-it-works/page.tsx:67>)), and there is no `position: sticky` anywhere in its CSS ([`src/app/(marketing)/how-it-works/how-it-works.module.css:44`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/how-it-works/how-it-works.module.css:44>)-[`173`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/how-it-works/how-it-works.module.css:173>)).
- `/pricing` misses the promised retention compare-table. The feature block explicitly asks for “Compare-table for retention windows” ([`FEATURES.md:672`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:672>)). The page only repeats a single “History retained” row inside each tier card ([`src/app/(marketing)/pricing/page.tsx:123`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/pricing/page.tsx:123>)-[`133`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/pricing/page.tsx:133>)).
- SEO is still thin. The review checklist calls for meta tags, OG image, and structured data ([`FEATURES.md:686`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:686>)). The home page has title/description text only; there is no `openGraph.images` and no JSON-LD anywhere in the marketing routes ([`src/app/(marketing)/page.tsx:5`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:5>)-[`15`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/page.tsx:15>)).
- Pricing numbers were shipped as fixed literals while the prior evidence still said pricing awaited MG confirmation ([`_reviews/2026-06-20_block17a-marketing-hero.md:54`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:54>)-[`56`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-20_block17a-marketing-hero.md:56>), [`src/app/(marketing)/pricing/page.tsx:22`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/pricing/page.tsx:22>)-[`80`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(marketing)/pricing/page.tsx:80>)). That is an unforced product-governance miss.

---

## Decisions (captured 2026-06-20, MG at checkpoint)

### /how-it-works interaction (spec: sticky-stacked sections)
- **Decision:** Build the sticky-stacked scroll.
- **Action:** Rebuilt as pinned sheets that stack Connect→Forecast→Reorder→Receive,
  mini-chain advances per stage. DOM-verified. Tests green.

### Rest of the findings + shipping
- **Decision:** Fix evidence, defer the rest to 17c, push.
- **Action:** Stale 17a evidence replaced by `_reviews/2026-06-20_feature_marketing.md`
  (accurate). /about + /contact, OG image + JSON-LD, Lighthouse, Playwright capture,
  dedicated retention compare-table → 17c / `_tickets.md`. Raw-px held (standing
  house-style + stack-audit ticket). Hero visual stays deferred (MG-directed).
  Committing + pushing 17a + 17b.

### Pricing numbers
- **Decision:** Ship MG's draft ($129 / $299 / $599 + Custom). Confirmed.
