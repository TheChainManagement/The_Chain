# The Chain — Master Prompt
*Phase 4 artifact. Required by PROCESS.md.*
*Created: 2026-05-30.*

> Per-project execution rules. Distinct from `EXECUTOR_PROMPT.md` at the MoreTech root (the global executor context).
>
> Every Phase 5 / 6 / 7 build session is judged against this document. The Codex review at every code phase pressure-tests adherence to these rules.

## Project overview

The Chain is a More Technologies internal SaaS for small-to-mid B2B distributors. It runs AI-driven supply chain optimization: statistical demand forecasting (Nixtla `statsforecast`), inventory policy derivation (reorder point, safety stock, recommended order qty), supplier reliability scorecards, ABC + XYZ classification, and a visible PO chain that operators trust to move real inventory and real money. Built to SELL — the architecture is the acquisition asset. Quality-gated, time-unbounded. Solo build by MG with Claude as build partner. First-release beachhead: SMB distributors on QuickBooks Online. Architecture wired for the full vision (multi-tenant, multi-location, multi-user, role-based, full integration adapter coverage, retention tiers, durable workflows); releases ship as waves of UI on top of a data layer that already supports them.

## Strict instructions

### Always

- **Use design tokens from `DESIGN_DIRECTION.md` and `DESIGN.md` for every color, font, spacing unit, shadow, motion timing.** Reference CSS variables only. No hardcoded values anywhere. Shadow tokens specifically: `--shadow-cobalt-inner` for cobalt-button inner highlight, `--shadow-cobalt-diffusion` for cobalt-button outer tint. Both declared in `DESIGN_DIRECTION.md`.
- **Mono fonts for every consequential number.** IBM Plex Mono with tabular numerics. VISUAL_DENSITY 7 ("Cockpit Mode") is a project-level commitment.
- **Honor the cobalt hierarchy.** Cobalt is permitted on (1) primary CTAs, (2) the active link in the visible PO chain, (3) one selected state per region, (4) the brand-mark glyph. The Chain component is one collective intent slot. Maximum 4 intents per visible viewport. Demote anything else.
- **Honor the trust hierarchy via named components.** Statistical model output renders via `<StatNumber>` (Plex Mono deep slate, tabular nums). Claude explanation renders via `<ClaudeInsight>` (Plex Sans body, Plex Mono "Claude · {topic}" prefix label). User actions render via `<ActionButton>` (cobalt CTA). The three components are the ONLY paths to those render kinds — lint check enforces. Phase 6 review greps for inline number-rendering or inline Claude prose to catch drift.
- **Ship a visible craft delta with every feature.** MG bar (2026-05-30): every feature ships with at least one distinctive interaction, layout move, or motion moment beyond design-token compliance. Each `FEATURES.md` block names its memorable element AND the Codex review checklist for every block requires "Memorable element visible in preview screenshot or Playwright interaction test." If the screenshot/test is absent at Phase 6 push, the feature is not done. The screenshot/test artifacts land at `projects/the-chain/_reviews/<date>_feature_<name>_memorable.png` or `_memorable.test.ts`.
- **Architect for the full vision; release in waves.** Schema, RLS policies, adapter contracts, audit log, and durable workflow primitives are scoped to the full roadmap on day one. No future wave requires a schema change or foundational refactor.
- **Use Vercel platform-native primitives by default.** Fluid Compute (Node + Python), Workflow DevKit for durable orchestration, AI Gateway + AI SDK v6 for Claude, Vercel Blob for cold archive, Vercel Cron for schedules. Edge runtime is NOT used.
- **Server Components first.** Data fetching lives in Server Components. Mutations through Server Actions with `idempotency_key` on every external-write action. Client components only where interactivity demands.
- **Workflow DevKit boundary.** `"use workflow"` is orchestration only — no real I/O. `"use step"` owns every external API call, database write, and side effect. Steps are idempotent and produce serializable return values.
- **Audit log every state-changing mutation.** `before`/`after` jsonb must carry enough information for Wave 6 ROI Impact Dashboard to compute stockout reduction, inventory reduction, and expediting cost from history.
- **Maintain marketing vs app surface split.** `/(marketing)` routes use no bench layout, no rails. `/(app)` routes are the Working Bench. The two share design tokens, never share layout chrome.
- **`:focus-visible` on every interactive element.** Cobalt ring on neutral surfaces; deep-slate ring on cobalt buttons. No bare focus rings.
- **`prefers-reduced-motion` respected.** Global block disables animations and transitions.
- **Real-feeling fragments in copy and data.** Customer fragments like "Calhoun Foods" / "Riverbend Hardware" / "Atchafalaya Distributing." Organic numbers like 47.2%, 8.3 days, 1,247.20. Never round demo numbers, never "Acme / Nexus / John Doe."
- **Leave evidence per PROCESS.md Hard Rule 8.** Every skill invocation produces an artifact on disk under `projects/the-chain/_reviews/<date>_<unit>_evidence.md`.

### Never

- **Hardcode colors, font names, spacing, shadow, or motion values.** All values come from CSS variables declared in `DESIGN_DIRECTION.md` / `DESIGN.md`.
- **Use Inter, Roboto, Geist Sans, Geist Mono, Fraunces, or Instrument Serif anywhere.** They are either banned by the taste-skill (Inter / Roboto), or taken by other MoreTech projects (Geist by TradeMore, Fraunces by the parent site, Instrument Serif by TradeMore).
- **Use cobalt outside its hierarchy.** Headline accents lean on weight, not color. Done-state chain dots and connector hairlines are part of the single Chain intent slot, not separate slots. Confidence bars use hairline tracks + deep-slate ticks, not cobalt fills.
- **Use gold / forest green / terracotta / warm cream anywhere.** Those are owned by other MoreTech projects (More App, More Tech site).
- **Use card drop shadows on idle surfaces.** Panels are flat with hairline borders. Focused panels get an inner shadow at most.
- **Use a 3-column generic card grid as a page archetype.** The metric strip uses border-divides, not cards. The Working Bench uses rails + hairline-bordered panels.
- **Animate `top` / `left` / `width` / `height`.** `transform` + `opacity` only. Scroll progress uses `transform: scaleX()` with `transform-origin: left`.
- **Use linear easing on user-visible motion** (exception: progress indicators that encode value linearly, documented inline).
- **Use `useState` for magnetic / cursor-following effects.** Use `useMotionValue` + `useTransform` from Framer Motion.
- **Mix Framer Motion + GSAP + Three.js in the same React tree.** Framer Motion for UI motion. No GSAP. No Three.js.
- **Use neon outer glows on cobalt.** Use `--shadow-cobalt-inner` (inner highlight) + `--shadow-cobalt-diffusion` (outer tint to cobalt hue) tokens. Both declared in DESIGN_DIRECTION.md. Never inline the rgba values.
- **Skip a declared skill.** When PROCESS.md or any canonical doc names a skill, INVOKE THAT SKILL. No substitutions. No "philosophy inheritance." See `feedback_never_skip_declared_skills.md`.
- **Push to GitHub without the Codex Conversation Flow at Phases 5–7.**
- **Claim a skill ran without its declared artifacts on disk.**
- **Generate forecasts via Claude / any LLM.** Statistical models only. Claude is interpretation, never the forecaster.
- **Write fake or placeholder numbers in any sample, fixture, or demo.** Organic values only.
- **Display Claude prose as a number, or display a statistical number as plain prose without its tabular form alongside.** Trust hierarchy is enforced by render.
- **Ship a feature without naming its memorable element.** If the `What's memorable` line is empty in `FEATURES.md`, the feature is under-designed.

## Code style guidelines

- **Language:** TypeScript, strict mode (`strict: true`, `noUncheckedIndexedAccess: true`). Python 3.13 for the forecasting function.
- **Linter / formatter:** Biome (or ESLint + Prettier as fallback if Biome is unavailable). 2-space indent. Single quotes. Trailing commas multiline.
- **Naming conventions:**
  - Files: kebab-case (`reorder-recommendations.ts`).
  - Components: PascalCase (`ChainPanel`, `ReorderQueueRow`).
  - Server Actions: camelCase (`approvePurchaseOrder`, `convertRecommendationToPo`).
  - Database tables: snake_case plural (`purchase_orders`, `inventory_levels`).
  - Database columns: snake_case (`external_po_id`, `last_synced_at`).
  - Workflow functions: camelCase suffix `Workflow` (`qboInitialSyncWorkflow`).
  - Step functions: camelCase, no suffix.
- **Component conventions:**
  - One component per file. Co-locate the component CSS module if used.
  - Components named for the THING they render, not the position (`ChainPanel`, not `BottomPanel`).
  - Props typed explicitly; no `any`.
  - Server vs Client boundaries declared at the file top. Default to Server.
- **Test conventions:**
  - Vitest for unit + integration tests. `@workflow/vitest` plugin for workflow tests.
  - Test files co-located: `Component.test.tsx` next to `Component.tsx`.
  - One assertion per test where possible; describe the BEHAVIOR being tested.
  - CI cross-tenant probe test: for every table, attempt a select as Tenant A while logged in as Tenant B — must return zero rows.
- **Commit message conventions:** Conventional commits prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`). Subject under 70 chars. Body describes the WHY, links to FEATURES.md feature when relevant.

## Output formats

### Folder structure

```
projects/the-chain/
├── PROJECT.md                  (Phase 0)
├── PRD.md                      (Phase 1)
├── SYSTEM_DESIGN.md            (Phase 2)
├── DESIGN_DIRECTION.md         (Phase 3)
├── DESIGN.md                   (Phase 3, Stitch-compatible)
├── FEATURES.md                 (Phase 4)
├── MASTER_PROMPT.md            (Phase 4, this file)
├── _knowledge/                 (research, references)
├── _assets/                    (social, video)
├── _reviews/                   (Codex review evidence trail)
├── samples/                    (Phase 3 hero, future per-feature samples)
└── src/                        (Phase 5+ source code)
    ├── app/
    │   ├── (marketing)/        (public marketing surfaces, no rails)
    │   ├── (auth)/             (sign-up, sign-in, password reset)
    │   ├── (app)/              (Working Bench — gated by Supabase session)
    │   │   ├── today/
    │   │   ├── inventory/
    │   │   ├── forecasts/
    │   │   ├── suppliers/
    │   │   ├── reorder/
    │   │   ├── flow/           (alerts, audit log, connections, sync conflicts)
    │   │   ├── settings/
    │   │   └── onboarding/
    │   └── api/                (route handlers: OAuth, exports, workflow resume)
    ├── components/             (shared components: ChainPanel, MetricStrip, etc.)
    ├── lib/                    (utility modules, source-adapter contract, AI prompts)
    ├── workflows/              (Workflow DevKit orchestrators + steps)
    ├── styles/                 (globals.css, token mappings)
    └── tests/                  (cross-tenant probe + integration tests)

/api/forecast/                  (Python function — Vercel Fluid Python, separate function)
```

### File structure

- **Components:** `src/components/<ComponentName>/<ComponentName>.tsx` + co-located `.test.tsx` + optional `<ComponentName>.module.css`.
- **Trust-hierarchy named components** (these are the canonical render paths; lint checks for inline alternatives): `src/components/StatNumber/StatNumber.tsx` (Plex Mono tabular numerics for statistical output), `src/components/ClaudeInsight/ClaudeInsight.tsx` (Plex Sans + Plex Mono "Claude · {topic}" prefix for AI explanation), `src/components/ActionButton/ActionButton.tsx` (cobalt CTA wrapper with `--shadow-cobalt-inner` + `--shadow-cobalt-diffusion`).
- **Other base components from Foundation:** `Panel`, `ChainLink`, `MetricCell`.
- **Pages / routes:** Next.js App Router conventions (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` per segment).
- **Server Actions:** `src/app/.../actions.ts` per segment. Action signature: `(input) => Promise<{ ok: true, data } | { ok: false, error }>`.
- **API routes / functions:** `src/app/api/<route>/route.ts`. Python forecast function lives at `/api/forecast/index.py` per Vercel conventions.
- **Workflows:** `src/workflows/<workflowName>.ts` for orchestrators; `src/workflows/steps/<stepName>.ts` for step functions.
- **Tests:** Co-located unit tests; integration tests under `src/tests/integration/`; CI cross-tenant probe under `src/tests/security/`.
- **Styles:** `src/styles/globals.css` carries the CSS variable declarations from `DESIGN_DIRECTION.md`. Per-component styles via CSS modules where Tailwind utility classes are insufficient.

## Production-ready mandate

A feature is "done" only when ALL of these are true:

- All MG-approved acceptance criteria from `FEATURES.md` for the feature met.
- The feature's "What's memorable" element is implemented AND captured as a screenshot or driveable Playwright interaction test at `_reviews/<date>_feature_<name>_memorable.{png,test.ts}`. If the artifact does not exist on disk, the feature is not done.
- Empty / loading / error states present for every async surface, on-direction.
- WCAG 2.1 AA passed for the feature's surfaces.
- Lighthouse Performance ≥ 85 for any user-visible page the feature touches.
- All CI tests pass including the cross-tenant probe, role-matrix probe, and (for Foundation) the wired-for verification suite.
- Workflow DevKit boundary respected: orchestrators in `"use workflow"`, all I/O in `"use step"`.
- No hardcoded design values. Token discipline holds.
- Codex review passed at the per-feature checkpoint (Phase 6) with all findings addressed or explicitly accepted.
- Evidence trail on disk at `_reviews/<date>_feature_<name>.md`.

## Performance test harness

All `p95 < N ms` acceptance criteria in `FEATURES.md` are measured under the following standard harness unless otherwise specified:

- **Environment:** Vercel Preview deployment for the active PR, not local dev.
- **Cache state:** Warm cache after one prior identical request from the same client.
- **Seeded data shape:** Tenant fixtures `seed-5k` (5,000 active SKUs, 200 suppliers, 12 months of `stock_movements`) and `seed-50k` (50,000 active SKUs, 1,000 suppliers, 24 months of movements) loaded via `npm run seed`.
- **Client:** Headless Chromium via Playwright, Lighthouse-mobile profile by default (Moto G4 simulated).
- **Repeated samples:** 10 runs; report p50 and p95.
- **CI runner:** Same instance class for every benchmark to avoid noise.

Stress tests (non-SLO, used to verify graceful degradation) run against `seed-50k` and are flagged in their acceptance criteria as `non-SLO stress test`. They must complete without OOM, document any backpressure observed, but are not gated on a hard latency number.

## References

Don't trust this document in isolation. Cross-reference these on every build session:

- [`PROJECT.md`](PROJECT.md) — vision, audience, type, build philosophy.
- [`PRD.md`](PRD.md) — features, flows, success criteria.
- [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) — architecture commitments (schema, RLS, adapter contract, workflows, retention).
- [`DESIGN_DIRECTION.md`](DESIGN_DIRECTION.md) — design tokens (THE source of all colors / fonts / spacing / motion).
- [`DESIGN.md`](DESIGN.md) — Stitch-compatible semantic system.
- [`FEATURES.md`](FEATURES.md) — per-feature build plans.
- `/Users/themoreapp/More Technologies/PROCESS.md` — the doctrine.
- `/Users/themoreapp/More Technologies/_knowledge/references/taste-skill/SKILL.md` — motion + anti-slop discipline.

And the standing rules in `/Users/themoreapp/.claude/projects/-Users-themoreapp-More-Technologies/memory/`:
- `feedback_build_philosophy_wire_for_full_vision.md` — wire for full vision, release in waves.
- `feedback_visible_craft_in_every_release.md` — visible delta in every feature.
- `feedback_never_skip_declared_skills.md` — invoke every declared skill.
- `feedback_skill_compliance_audit.md` — leave evidence, never fake it.
