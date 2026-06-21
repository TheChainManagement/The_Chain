# Marketing UI overhaul — "too plain" re-cut (2026-06-21)

**Skill:** `build-beautiful` (UPGRADE mode — design DNA already locked in
`DESIGN_DIRECTION.md`, so this deploys the existing language richly onto the
marketing surface rather than re-deciding it). Design collaboration with Codex
(gpt-5.4, `codex exec`) for the premium art direction, per MG's request to
reference Codex the way the prior project did.

## Why
MG EOD 2026-06-20: the marketing site "just looks plain… everything just looks
plain." `/how-it-works` "doesn't look good at all" — pure type + text labels,
dead whitespace. Four finished hero renders sat UNUSED in `public/marketing/`.
Ties to [[feedback_visible_craft_in_every_release]] — the 5-second visual jump
the prior pass missed.

## The vision (Codex + synthesis)
The product app stays austere (operator restraint); the MARKETING surface is
allowed to be cinematic in the SAME language. The move that makes it pop instead
of "renders in boxes": **composite the imagery with `mix-blend-mode: multiply`**
so the isometric model reads as PRINTED onto the drafting-paper bench (white PNG
box gone), with a rotated engineering blueprint as the working underlay, and the
notched-link PO-chain grammar threaded through as the page's connective logic.

## What shipped

### Hero (`/`)
- Two-zone, non-centered (VARIANCE 6). Copy left, composited model bleeding right.
- `TheChainHero1.png` isometric model composited via `mix-blend-mode: multiply`
  over `bg-blueprint.jpg` (rotated -1.2°, masked) — model sits on the bench.
- Headline "Everything is connected." stamps in on the **Mona Sans width axis**
  (wdth 60 → 78), line-staggered — a label locking into registration.
- Live **PO chain** (DEMAND·FORECAST done → PO ignites cobalt → SUPPLIER·RECEIVED
  pending), the product motif as a compact marketing variant of `ChainLink`.
- **HeroScrubber** signature detail: cobalt crosshair + mono coordinate readout
  on cursor over the model (rAF + CSS vars, no per-frame React state; pointer-fine
  only; hidden under reduced-motion). "Inspect the engineering print."
- Cobalt leader vector from the copy toward the model's lit chain.

### How it works (`/how-it-works`)
- Replaced the type-only sticky stack with a **guided blueprint workbench**:
  - Sticky cobalt **chain rail** (left) advances its lit link per stage.
  - Scrolling **inspection plates** (center) — dense, corner-cut, big cobalt
    metric per stage (15 min / 94.6% / 8.3 days / 47.2%). Kills the dead space.
  - Sticky **visual** (right) re-crops the model/blueprint to the active stage via
    `object-position` + a gliding cobalt **target bracket** + live caption.
  - Stage tracking via `IntersectionObserver` (no scroll library). Mobile: visual
    sticks on top, plates scroll under; reduced-motion un-sticks + shows all.

## Verification
- Live-verified all 4 how-it-works stages (distinct crops, advancing rail, metric
  + bracket move together) + hero load (model settle, headline stamp, chain
  ignite) in Claude Preview at 1440 / 390 widths. Screenshots in chat.
- `npm run typecheck` clean. `npm run lint` (biome, 265 files) clean.
- `npm run check:craft` PASS (token discipline + trust hierarchy). Added a
  documented OG-image carve-out (satori can't resolve CSS vars) + fixed a
  comment false-positive — both pre-existing 17c craft reds, now green.
- `npx vitest run` — **653/653 pass** (marketing how-it-works `data-testid` +
  hero memorable-guard updated for the two-line H1; jsdom guards added for
  `matchMedia` / `IntersectionObserver`).
- `npm run build` clean (full route manifest, PPR intact).

## Open / next
- Awaiting MG binary verdict (ship / pivot) on hero + how-it-works.
- If ship: carry the visual language to `/pricing`, `/about`, `/contact`.
- Hero leader-vector endpoint floats slightly; refine or drop.
- Lighthouse ≥90 still a Preview-run ticket (Block 17 acceptance).
- Photoreal chain macros (`TheChainHero3/4.png`) not yet used — candidate for a
  pricing/CTA band.
