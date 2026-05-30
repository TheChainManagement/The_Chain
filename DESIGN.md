# Design System: The Chain
**Project ID:** Internal — `the-chain` (Phase 3 source of truth, 2026-05-30)
*Stitch-compatible semantic system per `design-md` skill. Synthesized from `DESIGN_DIRECTION.md`, `samples/hero.html`, the More Technologies parent brand pack, and the taste-skill discipline rules.*

## 1. Visual Theme & Atmosphere

The Chain reads like the daylight side of a freight terminal control room rendered on cool drafting paper. The atmosphere is precise, operator-grade, daylight-engineering, and quietly serious. Surfaces are flat, never glossy. Density is operator-tight inside data zones, generous around panel headers. Trust is communicated through legibility and tabular precision, never through decoration. The signature gesture is a horizontal chain of typeset link blocks across the page, with cobalt flowing through the chain as each PO advances. The aesthetic axis: **"Operator's Workshop. A daylight engineering print."**

## 2. Color Palette & Roles

- **Drafting Paper Cool (#F5F7FA)** — Page surface. The "paper" of the daylight bench. Every panel sits on this.
- **Working Bench White (#FFFFFF)** — Panel surface. Where data actively lives.
- **Inset Pewter (#EDEFF3)** — Recessed zones. Right-rail context column, dense data inset panels.
- **Deep Slate Ink (#11161C)** — Primary text, headings, table values. The ink of the print. Replaces pure black.
- **Mid Slate (#54616F)** — Secondary text, body copy in panels.
- **Dim Annotation (#5C6573)** — Tertiary text, mono labels, captions. Passes WCAG AA at ~4.6:1 on white. Replaces the earlier #8A95A3 which failed AA.
- **Hairline Pewter (#D8DDE3)** — 1px rules separating panels and table rows.
- **Heavy Divider (#B6BFCA)** — 2px section dividers, footer rule.
- **Cobalt Signal (#0942B5)** — THE working accent. Primary CTAs, the active link in the visible PO chain, one selected state per region, and the brand-mark chain glyph. Strict priority hierarchy — never decoration.
- **Cobalt Bright (#1B5BD9)** — Hover/active state of cobalt elements.
- **Cobalt Tint (rgba 9,66,181,0.08)** — Selection backgrounds. Almost invisible.
- **Cobalt Hairline (rgba 9,66,181,0.20)** — Cobalt-toned 1px lines on chain connectors and selected borders.
- **Flow Green (#1A8C5C)** — On-flow / good / on-time semantic. Live indicators, on-time supplier badges. Replaces cobalt on the eyebrow live-dot so cobalt is reserved for brand intent.
- **Warning Amber (#BE7C0E)** — Watch state. Distinct from parent More Technologies terracotta.
- **Stop Red (#B5142B)** — Critical, blocked, stockout state.
- **Info Steel (#3661A1)** — Informational badges. Cooler and paler than cobalt to avoid confusion with brand accent.

## 3. Typography Rules

**Display family: Mona Sans (GitHub, OFL).** Variable-width axis is the design signature.
- **Hero headlines:** weight 800, width 75 (condensed), letter-spacing 0. Lands like text stamped on a crate.
- **Section + rail labels:** weight 700, width 80 (slightly condensed), uppercase, letter-spacing 0.14em.
- **PO identifiers + reference numbers:** weight 700, width 125 (extended). Identifiers feel like real stamped references.
- **Panel headings:** weight 700, width 100 (default).

**Body family: IBM Plex Sans (Google Fonts, OFL).** Operator-credible grotesque for dense UI legibility.
- Body paragraphs: weight 400, 15px, line-height 1.55, letter-spacing 0.
- Strong body emphasis: weight 600.
- Labels: weight 500.

**Mono / Numeric family: IBM Plex Mono (Google Fonts, OFL).** Used for every consequential number, every mono caps label, and every reference code.
- Hero metric numerics: weight 600, 30px, tabular nums, letter-spacing -0.01em.
- Body numbers in tables: weight 500, tabular nums.
- Mono caps labels (rail-label, eyebrow, panel prefix): weight 500, 10-11px, letter-spacing 0.14–0.18em uppercase.

**Universal rule:** every consequential number on the page is IBM Plex Mono. Never IBM Plex Sans for numbers. Confirms VISUAL_DENSITY 7 "Cockpit Mode" per the taste-skill discipline.

## 4. Component Stylings

- **Buttons.** Primary CTA: cobalt fill (#0942B5), white text, 1px cobalt border, sharp square corners (no rounding). 14px / 20px padding. Hover brightens fill to #1B5BD9, adds `--shadow-cobalt-inner` (inner refraction highlight) + `--shadow-cobalt-diffusion` (outer tint to cobalt hue). Never a neon glow. Active state: 1px Y translate. Focus-visible: 2px deep-slate outline with 2px offset (cobalt-on-cobalt would disappear). Secondary action: text link in deep slate with a hairline underline that scales-from-left on hover, transitioning to cobalt on hover. No background.

- **Panels (replaces "cards").** White surface (#FFFFFF) with 1px hairline border (#D8DDE3). Sharp corners. No drop shadow on idle surfaces. Inner padding 24px. Focused panel uses a 1px inner shadow at top-left corner only. Panel headers carry a tiny diagonal corner-cut at the top-right (5px clipped corner) — a subtle blueprint reference. Empty panel zones carry a dotted lattice background (4px-on-center hairline-pewter dots at 6% opacity).

- **The Chain (signature component).** Horizontal row of typeset link blocks with notched connectors between them. Each link contains a mono uppercase step label (Supplier, Ordered, In transit, Received, On hand), a Plex Sans heading, and a Plex Mono timestamp.
  - *Done link:* inset pewter fill, hairline border, deep slate text, small cobalt dot at top-right corner.
  - *Active link:* cobalt fill, white text, with cobalt-bright inner highlight. Page-load motion: cobalt fills from left to right over 600ms with spring physics — the chain's signature motion.
  - *Pending link:* white fill, hairline border, dim annotation text. Empty waiting state.
  - *Connectors:* 1px line between adjacent links. Cobalt-hairline between done-and-done and done-and-active; pewter hairline between active-and-pending.
  - *Time-axis ruler beneath:* 1px pewter hairline with discrete tick marks at day intervals; today's position marked with a small deep-slate "you are here" tick.

- **Inputs / Forms.** Label above input. Input has 1px hairline border, sharp corners, white surface. Focus: 1px cobalt border. Helper text below in dim annotation. Error text below in stop red.

- **Tables / data rows.** Hairline dividers between rows. No card boxes around tables. Numbers in IBM Plex Mono tabular. Selected row: cobalt-tint background + cobalt left-border hairline (counts as 1 of the cobalt allotment for that viewport).

- **Status badges.** Tiny uppercase mono text, 10px, semantic background (flow green, warning amber, stop red, info steel). 2px / 6px padding. Never cobalt — cobalt is brand intent, not status.

## 5. Layout Principles

**Working Bench grid.** At desktop, three zones: 220px left rail (navigation) + 1fr main work surface + 280px right rail (contextual info, AI explanation). The rails are the rhythm, not a 12-column page. Mobile collapses both rails — left becomes a top sheet, right becomes a sliding panel — to maintain operator-grade legibility on small screens.

**Density.** Operator-tight (4px base unit) inside data zones. Generous (32px–48px) around panel headers and hero. VISUAL_DENSITY 7 per taste-skill means: tiny paddings inside data tables, mono font for every number, 1px lines instead of card boxes wherever possible.

**Rules over cards.** Hairlines and dividers separate panels and sections. No card drop shadows on idle surfaces. The bench is flat the way a drafting bench is flat.

**Asymmetry.** DESIGN_VARIANCE 6 per taste-skill. The bench is asymmetric by design (rails of unequal width, content sits between them, never centered). Hero is left-aligned with a chain-demo column. Centered hero is banned at VARIANCE 6.

**Atmosphere details.** Dotted lattice in empty panel zones, throughput hairline at the bottom of the work surface with discrete cobalt notches, corner-cuts on panel headers. None of these are decoration — each one earns the "engineering print" axis.

**Trust hierarchy.** Statistical model output renders in IBM Plex Mono numerics on deep slate (source of truth). Claude explanation renders in IBM Plex Sans body with a tiny IBM Plex Mono prefix label (interpretation layer). User actions are cobalt CTAs or cobalt-bordered inputs (action layer). The three are visually distinct by design. Claude never appears as a number; statistical outputs never appear as prose without their numeric form alongside.
