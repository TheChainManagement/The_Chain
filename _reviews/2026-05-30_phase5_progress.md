# Phase 5 Foundation — Progress (paused 2026-05-30)

Four sub-phases complete, six remaining. Resume by reading this file + `FEATURES.md` §Wave 1 Foundation block, then continue at 5E.

## Done

- **5A — Bootstrap** (commit `ea8314d`). Next.js 16 + React 19 + Tailwind 4 + TypeScript 6 (strict), Biome, `next/font` for Mona Sans + IBM Plex Sans + IBM Plex Mono, `cacheComponents: true`, all design tokens from DESIGN_DIRECTION.md in `src/styles/globals.css` via `@theme inline`, Supabase scaffold (`supabase init`).
- **5B — Schema migrations** (commit `8d42d25`). 8 migration files, 764 lines of SQL covering every table from SYSTEM_DESIGN.md. Partitioned `audit_log` + `stock_movements` with 2026 + 2027 + default partitions. Enums, `updated_at` triggers, `token_generation` bump trigger on `tenant_members`, operational indexes, RLS enabled.
- **5C — RLS + auth scaffold** (commit `4578ebc`). `jwt_tenant_id`, `jwt_role`, `jwt_token_generation`, `has_role`, `is_owner`, `is_token_stale` helpers. Full RLS policy matrix for 34 tables. `custom_access_token_hook` registered in `supabase/config.toml`. `@supabase/ssr` clients (server / browser / middleware). `src/proxy.ts` with explicit defense-in-depth disposition (per `vercel-plugin:routing-middleware` skill: proxy is NOT sole auth gate; RLS + layout-server-check are the primary gates).
- **5D — SourceAdapter contract** (commit `89d378d`). `SourceAdapter` TypeScript interface, canonical zod schemas per `EntityKind`, `RetryableError` + `FatalError` taxonomy, `Cursor`, `AdapterCapabilities`, `PullResult`, `PushResult`, `CanonicalPayload`, `CANONICAL_SCHEMA_VERSION` constant, `canonicalSchemasByKind` registry.

## Remaining

- **5E — Workflow DevKit + smoke workflow.** Install `workflow`, `@workflow/next`, `@workflow/ai`. Write one trivial end-to-end workflow (`"use workflow"` orchestrator + `"use step"` unit) as smoke test. Verify `npx workflow health` passes. Re-invoke `vercel-plugin:workflow` skill before drafting.
- **5F — Audit log triggers.** Postgres trigger dispatcher fn that captures `before`/`after` jsonb on every mutating tracked table. Required fields per entity (inventory_levels, purchase_orders, stock_movements) for Wave 6 ROI computation. Test: mutate each tracked table; assert audit row + required jsonb fields.
- **5G — Base components.** `StatNumber` (Plex Mono tabular numerics), `ClaudeInsight` (Plex Sans + Plex Mono "Claude · {topic}" prefix), `ActionButton` (cobalt CTA with `--shadow-cobalt-inner` + `--shadow-cobalt-diffusion`), `Panel`, `ChainLink`, `MetricCell`. All on tokens only. Each with empty/loading/error states, Storybook story, unit test. **Lint check enforces these are the ONLY paths to their render kinds (trust hierarchy).**
- **5H — App shell + auth-gated layouts.** `(marketing)` segment (no rails), `(auth)` segment (sign-up + sign-in), `(app)` segment (Working Bench layout with left + right rails, throughput hairline at bench bottom, today tick). The `(app)` layout MUST do a server-side auth check + redirect; this is the primary auth gate per the defense-in-depth disposition. **This is what the Phase 5 MG screenshot checkpoint lands on.**
- **5I — CI probes.** Vitest tests: cross-tenant RLS probe (logged in as Tenant A, query every table for Tenant B — must return zero rows), role-matrix probe (every (table, role) pair vs the matrix), wired-for verification suite (the 8 dry runs from SYSTEM_DESIGN.md §Wired-for acceptance tests). `npm run verify:foundation` aggregates results into the single-page report that IS the Foundation block's "What's memorable" artifact.
- **5J — Preview deploy + MG checkpoint.** `supabase start` locally, `npm run build` clean, `vercel link` + preview deploy. Capture screenshot of the running Working Bench shell. MG binary verdict (ship it or pivot). Then Codex full-weight Phase 5 review per PROCESS.md Hard Rule 9 before first push to GitHub.

## Standing rules in effect (review before next push)

- Build philosophy: wire for full vision, release in waves. No refactor-later mode. (`feedback_build_philosophy_wire_for_full_vision.md`)
- Visible craft delta in every release. (`feedback_visible_craft_in_every_release.md`)
- Never skip a declared skill. Invoke `vercel-plugin:workflow` before 5E. Invoke any Vercel skills auto-triggered by file writes during 5G/5H/5I. (`feedback_never_skip_declared_skills.md`)
- Phase 6 visible-craft gate (memorable element visible in preview screenshot or Playwright test) becomes active from 5G onward — base components should each ship with a memorable element captured.

## Local dev state

- Local git initialized at `projects/the-chain/`. Four commits. Nothing pushed.
- `node_modules/` installed. Typecheck clean.
- `supabase/` scaffolded but `supabase start` NOT yet run (defer until 5J or as needed for testing).
- `.env.local` NOT yet populated (template at `.env.example`).
