# The Chain — Design Direction
*Phase 3 artifact. Required by PROCESS.md. THE A1 phase.*
*Created: 2026-05-30. Revised: 2026-05-30 (Phase 3 RE-RUN per MG correction; build-beautiful skill formally invoked this time, all Phase 1 sub-skills run.).*
*Scope: The Chain marketing site + product UI. MoreTech Product (internal, in-house).*

> This document is the gate that prevents "all my apps look alike." Every prior MoreTech `DESIGN_DIRECTION.md` and the More Technologies parent brand pack were read before a single design choice was made on this re-run.

## Prior Art Read

| Project | Their direction | What we are NOT reusing |
|---|---|---|
| **The More App (Verdant Signal)** | Dark mode, forest green `#2D5A3D` + warm gold `#D4AF37`, geometric sans, dashboard with HUD overlays, Myles 3D gold orb + gold signal line. | Dark UI; gold accent; geometric/HUD atmosphere; 3D orb character; gold signal line; forest green. |
| **TradeMore (Midnight Observatory)** | Five-layer dark slate, gold `#C9A54E`, Instrument Serif (display italic) + Geist Sans + Geist Mono, observatory cockpit, gold signal line tracing card borders. | Dark UI; gold accent; signal-line-on-card-border motif; Instrument Serif italic titles; Geist Sans; Geist Mono; observatory metaphor. |
| **More Technologies (parent site)** | Warm cream `#F4EFE6` + deep ink `#1A1814` + terracotta `#C04A26`, Fraunces single-family across display + body, broadsheet 7+4 asymmetric, hairline rules, no cards, "is this a magazine?" reaction, page-load word-by-word headline reveal. | Warm cream palette; terracotta accent; Fraunces; single-family-only typography; editorial broadsheet archetype; word-by-word headline reveal; the "wait is this a magazine" half-second. |
| **MorePro** | No `DESIGN_DIRECTION.md` on disk. | n/a |

**Anti-convergence statement:** The Chain is **daylight engineering** with cool-light surfaces, deep slate ink, **cobalt signal** as the single working accent, a **Working Bench** layout (rails + flat panels + hairline rules, no cards), and a **visible PO chain** as the unforgettable element. It shares no color hue, no typeface, no layout archetype, and no signature motion with any prior MoreTech project. Codex Beat 2 review on 2026-05-30 confirmed PASS on all three anti-convergence axes vs all three prior projects.

## Parent Brand Context Read

Read in full: `/Users/themoreapp/More Technologies/projects/more-technologies-site/_knowledge/brand/More_Technologies_Brand_Package/`. Contents inventoried: README.txt, Color_Palette.png, Typography_Guide.png, Logo_Usage_Guidelines.png, More_Technologies_Brand_Identity_Guide.docx, Logo files (light, dark, mark-only), Applications/, Source_Files/.

**Parent brand assertions inherited:**
- Parent rule #4: *"Each product under More Technologies gets its own independent brand."* The Chain's distinct identity is the parent brand's official policy, not deviation.
- Parent rule #5: *"More Technologies appears in legal, investor, and hiring contexts only."* The Chain's product UI surfaces "More Technologies" only in the footer copyright line. No co-branding lock-up. No parent logo in the app.
- Parent rule #1: Logo black/blue elements never touch; maintain white gap. Not applicable to The Chain's independent mark (a 3-link cobalt chain glyph), but worth knowing for any future co-branded asset.

**Parent brand assertions deliberately diverged from:**
- Parent Brand Blue `#126AA9` (a lighter cyan-blue). The Chain uses Cobalt `#0942B5` (deeper, more confident, distinct). Documented divergence per parent rule #4.
- Parent typeface Instrument Sans. The Chain uses Mona Sans + IBM Plex Sans + IBM Plex Mono. Documented divergence per parent rule #4.

---

## Aesthetic Axis

> **Operator's Workshop. A daylight engineering print: precision, throughput, and the math of inventory rendered as honest, working surfaces. Not a dashboard. A working bench.**

The Chain reads like the daylight side of a freight terminal control room rendered on cool drafting paper. Tables and numerics are first-class citizens. Cobalt appears only where the operator's eye needs to follow the work. Decoration is banned. The product earns trust by being legibly, plainly correct.

## Mood References
*Each is unrelated to any prior MoreTech project.*

1. **Stripe Dashboard (light theme)** — operator-grade light UI, tables and tabular numerics first-class, restrained accent color.
2. **Linear marketing surfaces (brand site)** — precision grotesque typography, restrained whites, tight hierarchy.
3. **GitHub's Mona Sans launch site** — variable typography as the design language, engineering-brand atmosphere.
4. **NOAA nautical chart printing** — precision linework, depth contours, dimension callouts as the register of a real working chart.
5. **Orthographic engineering drafting prints** — clean line art, hairline rules, blueprint-corner-cut sheets, no decoration.

## Typography Pair

- **Display:** **Mona Sans** (GitHub, OFL, free). Variable-width axis is the visible signature.
  - Hero headlines: `wght 800; wdth 75` (heavy condensed). Lands like text stamped on a crate. Letter-spacing 0.
  - Section + rail labels: `wght 700; wdth 80`, uppercase, letter-spacing 0.14em.
  - PO identifiers and reference numbers: `wght 700; wdth 125` (extended). IDs feel like stamped references.
  - Panel headings: `wght 700; wdth 100`.
- **Body:** **IBM Plex Sans** (Google Fonts, OFL, free). Weights 400 (body), 500 (labels), 600 (strong). Letter-spacing 0.
- **Mono / Numeric:** **IBM Plex Mono** (Google Fonts, OFL, free). Tabular figures for every consequential number. Mono caps labels for rail headers, eyebrow text, and panel prefixes.

**Universal rule:** every consequential number on the page is IBM Plex Mono. Confirms VISUAL_DENSITY 7 ("Cockpit Mode" per taste-skill) which mandates mono for all numbers.

**Why this pair:** Mona Sans gives a contemporary engineering-print display voice with variable-width as its signature behavior. IBM Plex Sans + Plex Mono is the operator-tooling family with native credibility for data-heavy UI. None of the three appear in any prior MoreTech project. The choice is intentionally two-family (display + body/mono) so it does not converge on the parent site's single-family Fraunces strategy.

Loaded via Google Fonts:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Mona+Sans:ital,wdth,wght@0,75..125,200..900;1,75..125,200..900&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Color System

```css
:root {
  /* Surfaces — daylight engineering */
  --color-bg:        #F5F7FA;  /* drafting paper cool */
  --color-surface:   #FFFFFF;  /* working bench white */
  --color-inset:     #EDEFF3;  /* inset pewter, dense data zones */
  --color-deep:      #11161C;  /* deep slate ink — body and headings */
  --color-mid:       #54616F;  /* secondary text */
  --color-dim:       #5C6573;  /* tertiary text, labels (passes WCAG AA at ~4.6:1 on white) */
  --color-hairline:  #D8DDE3;  /* 1px rules */
  --color-divider:   #B6BFCA;  /* heavier dividers */

  /* Cobalt signal — the working accent */
  --color-signal:        #0942B5;  /* deep cobalt */
  --color-signal-bright: #1B5BD9;  /* hover / active */
  --color-signal-dim:    rgba(9, 66, 181, 0.08);   /* selection bg */
  --color-signal-line:   rgba(9, 66, 181, 0.22);   /* hairline accents on chain connectors */

  /* Shadow tokens — never inline these values; reference the tokens */
  --shadow-cobalt-inner:     inset 0 1px 0 rgba(255, 255, 255, 0.12);   /* inner refraction on cobalt buttons */
  --shadow-cobalt-diffusion: 0 8px 24px -16px rgba(9, 66, 181, 0.35);   /* outer tint to cobalt hue, not a neon glow */
  --shadow-panel-focus:      inset 1px 1px 0 rgba(17, 22, 28, 0.06);   /* 1px inner shadow at top-left of focused panel */

  /* Semantic — operator standard */
  --color-flow:      #1A8C5C;  /* on-time / good / in-flow */
  --color-warn:      #BE7C0E;  /* warning amber (NOT terracotta) */
  --color-stop:      #B5142B;  /* critical / blocked / stockout */
  --color-info:      #3661A1;  /* informational steel blue */
}
```

**Dominant:** drafting-paper cool surface + deep slate ink. Two colors carry 90% of every screen.

### Cobalt usage hierarchy (strict)

Codex Beat 2 flagged a vague "max ~3 per viewport" cap that the prior sample violated heavily. Replaced with a concrete priority hierarchy. Cobalt is permitted only on these intents, in this priority order:

1. **Primary CTA buttons** (one intent class; may appear in nav + hero on the same page).
2. **The active link in the visible PO chain** (the unforgettable thing in motion).
3. **One selected state per region** (active left-rail item, selected table row — pick one per visible region).
4. **The brand-mark chain glyph** (logo).

**Maximum 4 cobalt intents visible at any viewport.** Counting is by intent class, not by pixel. Repeating the same intent (the same CTA appearing twice) is one intent. Anything beyond requires explicit override.

**Carve-out: the Chain component is a single intent slot.** All cobalt expression within the visible PO chain — the active link's full fill, the cobalt-tinted hairline connectors between done links, and the small cobalt corner-dot on each done link — counts collectively as ONE intent slot (the unforgettable thing in motion). This is because the chain is a single semantic component with a coordinated visual language, not a collection of independent cobalt decorations. The same applies to the 3-link brand-mark glyph in the logo: it is one intent slot, not three.

**Demoted from cobalt** (and now neutral or semantic):
- Headline accent words → use weight emphasis only, not color.
- Done-state chain links → deep slate fill with a small cobalt dot at the corner.
- Live indicator dots in eyebrow + panel prefix → flow green (semantic, not brand).
- Right-rail "Why this reorder" label dot → flow green.
- Confidence indicator → 1px hairline track with a single deep-slate tick at the percentage, not a filled bar.
- Nav link hover underline → deep slate, not cobalt.

Semantic colors (flow / warn / stop / info) appear only in status contexts (badges, micro-bars on tables, live indicators). Never as brand decoration.

## Spatial System

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
}
```

**Grid: Working Bench.** Three zones at desktop — 220px left rail (navigation) + 1fr main work surface + 280px right rail (contextual info, AI explanation). Rails are the rhythm, not a 12-column page. Mobile collapses both rails. Density is operator-tight inside panels; breathing room sits in the rails and at panel headers.

**Rules over cards.** Hairlines (1px `--color-hairline`) + heavier dividers (2px `--color-divider`) separate panels and sections. No card drop shadows on idle surfaces. Focused panels get a 1px inner shadow at top-left corner only.

## Motion Principles

Operator credibility = restraint. Motion communicates state, never delight.

### Taste-Skill Dials

Read `_knowledge/references/taste-skill/SKILL.md` in full on the re-run. The dial values for The Chain:

| Dial | Value | Why this value |
|------|-------|----------------|
| `DESIGN_VARIANCE` | **6** | Working Bench grid with asymmetric rails sits above plain symmetry. Hairline-and-rule composition (not card boxes) raises variance further. Below 7 because the operator reads tables; high-variance compositions would fight legibility. |
| `MOTION_INTENSITY` | **5** | At the MoreTech motion floor. Three perpetual animations (pulse, shimmer, signal scan) plus scroll-progress moment clear the floor. We intentionally do not go higher because operators distrust theatrical motion when real money is moving. |
| `VISUAL_DENSITY` | **7** | "Cockpit Mode" per taste-skill — tiny paddings, no card boxes, 1px lines to separate data, **mono font for every number** (mandatory). Operator tools are dense. Generous on hero, tight in data zones. |

### Easing & Spring Tokens

```css
--ease-spring-soft:   cubic-bezier(0.16, 1, 0.3, 1);    /* page-load reveals */
--ease-spring-snappy: cubic-bezier(0.34, 1.56, 0.64, 1); /* button press, chain link ignite */
--ease-tick:          cubic-bezier(0.65, 0, 0.35, 1);   /* number ticks, signal scan, shimmer */
--duration-quick:     180ms;
--duration-base:      320ms;
--duration-reveal:    600ms;
--duration-tick:      600ms;
--duration-scan:      60000ms;
```

```ts
// Framer Motion default for this project
const spring = { type: "spring", stiffness: 120, damping: 22 };
```

### Perpetual Animations (MOTION ≥ 5 requires ≥ 2; we ship 3)

- [x] **Pulse** — flow-green dot beside "live" status labels. 2s cycle, very subtle.
- [x] **Shimmer** — loading skeletons in dense data panels. Implemented on the "next sync" placeholder in the source-connection panel.
- [x] **Signal Scan** — every 60 seconds, a 1px cobalt hairline traces left to right across the top of the visible bench. Discrete.

### Scroll Behavior (MOTION ≥ 5 requires one scroll moment)

- [x] **Scroll progress path** — a cobalt hairline at the top of long marketing pages, animated via `transform: scaleX()` with `transform-origin: left` per the taste-skill rule (never animate width). No parallax, no scroll hijack, no curtain reveals.
- Inside the app, scroll is local within panels. No global scroll choreography.

### Page-load orchestration (the chain reveal is the signature motion)

1. Signal scan starts (delayed 2.5s on first paint).
2. Nav fades up at 60ms.
3. Eyebrow at 200ms.
4. **Headline: single clean spring fade-up at 280ms** (NOT word-by-word stagger; that was a taste convergence with parent site, fixed on this re-run).
5. Sub-copy at 400ms.
6. CTA row at 500ms.
7. Chain meta line at 600ms.
8. **Chain links cascade in left-to-right at 650ms** (80ms stagger between links).
9. **Active link "ignites" in cobalt 200ms after it arrives** — cobalt fill flows in from the left connector via `transform: scaleX()` on a pseudo-element. This is the page's signature reveal motion: the chain coming alive.
10. Time-axis hairline draws across at 1100ms.
11. Metric strip cascades in at 1300ms.
12. Right-rail panels fade in at 1500ms.

**Library boundary:** Framer Motion for component motion. CSS keyframes for perpetual loops (pulse, shimmer, signal scan). No GSAP. No Three.js. No WebGL.

### Banned Tells (cross-checked every Phase 6 review)

- Centered hero with variance > 4 (we are at VARIANCE 6 → non-centered hero)
- Generic 3-column card grid as page archetype (Working Bench is rails + hairline-bordered panels, not card boxes; metric strip uses border-divides, not cards)
- Pure `#000000` (we use `#11161C`)
- Inter / Roboto / Geist Sans body font (we use IBM Plex Sans)
- Round demo numbers — use organic values like `47.2%`, `1,247.20`, `8.3 days`, `94.6%`
- Placeholder names "Acme / Nexus / John Doe" — use real-feeling fragments ("Calhoun Foods", "Riverbend Hardware")
- "Elevate / Seamless / Unleash / Game-changing" copy — banned everywhere
- Linear easing on user-visible transitions — spring physics only (scroll progress uses `transform: scaleX()` linear-tracking acceptable for progress indicators; documented exception)
- `top` / `left` / `width` / `height` animation — use `transform` + `opacity`
- `useState` for magnetic / cursor-following effects — use `useMotionValue` + `useTransform`
- Card drop shadows on idle surfaces
- Neon outer glows on cobalt elements — use inner highlight + tinted diffusion shadow instead
- Cobalt outside the hierarchy above

## Backgrounds & Atmosphere

- Drafting-paper cool page surface. Flat. No gradient meshes. No noise overlays. No mesh backgrounds.
- **Dotted lattice** — empty panel zones carry a 4px-on-center hairline-pewter dot pattern at 6% opacity, like engineering grid paper. Invisible until you look for it. Rendered via CSS `radial-gradient`.
- **Throughput hairline** — a persistent 1px hairline at the bottom of the main work surface, with discrete tick marks at every 64px. Today's "you are here" position marked with a 2px deep-slate tick. Earns the engineering-print axis.
- **Corner-cuts on panel headers** — top-right corner of every panel header carries a 5px diagonal cut (CSS `clip-path`). A subtle blueprint reference for operators who notice.
- Section dividers are hairlines. Some carry a small uppercase Mona Sans wdth-80 label hanging below (`STOCK`, `SUPPLIERS`, `FLOW`), letter-spaced, in dim annotation.
- Right rail uses inset pewter background to distinguish it from the main work surface.

## Visual Trust Hierarchy (codified)

The Chain's product premise depends on operators trusting AI explanations of statistical model output. The visual system enforces who said what.

- **Statistical model output** (forecasts, recommendations, reorder quantities, supplier reliability scores): IBM Plex Mono numerics in deep slate. Confidence bands shown as 1px gray ranges, not filled bars. This is the source of truth.
- **Claude explanation** (the "why this reorder" prose): IBM Plex Sans body text in deep slate, prefixed with a small IBM Plex Mono label "Claude · [topic]" in dim annotation. Always cited. Never displayed as a number.
- **User action** (CTAs, inputs, approvals): cobalt CTA buttons or cobalt-bordered inputs. Distinct from both the statistical and explanation layers.

The three layers must never be visually confused. Claude's prose can never appear as a Plex Mono number; a forecast can never appear as plain body prose without its Plex Mono form alongside.

## The Unforgettable Thing

> **Every PO is a chain you can see.** A horizontal sequence of typeset link blocks with notched connectors, running across the dashboard: `supplier → ordered → in-transit → received → on-hand`. Cobalt flows through the chain as each PO advances state — done links carry a small cobalt dot, the active link is fully cobalt-filled, pending links wait empty. On page-load, the active link "ignites" with a cobalt fill flowing in from the left. Operators do not watch a status bar. They watch the chain advance.

That single visual element is the product's icon, primary metaphor, and name brought to life. It appears on the marketing hero, the dashboard, every PO detail panel, email notifications, and the favicon. The brand-mark logo is a 3-link reduction of the same chain.

---

## Sample Page
- [x] `samples/hero.html` exists and renders this direction (revised this re-run with cobalt cap fix, dotted lattice shipped, shimmer shipped, focus-visible added, contrast fixed, mailto fixed, letter-spacing zeroed, Mona Sans width axis visible, headline single-spring reveal, chain ignite, time-axis ruler, throughput hairline, corner-cuts).
- [x] MG has given verbal "ship it" on the first pass on 2026-05-30. This re-run preserves the locked direction and addresses Codex Beat 2 findings; awaiting MG binary verdict on the revised sample.
- [ ] New Codex Beat 2 review on the revised artifacts (after MG verdict).

**Phase 3 checkpoint:** binary. Ship or pivot. No "looks fine, keep going."
