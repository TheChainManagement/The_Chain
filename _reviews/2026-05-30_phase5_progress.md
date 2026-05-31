# Phase 5 Foundation — Progress (updated 2026-05-31)

Five sub-phases complete, five remaining. Resume by reading this file + `FEATURES.md` §Wave 1 Foundation block, then continue at 5F.

## Environment note (2026-05-31)

- **Node 24 is required and was installed via nvm** (`nvm install 24` → v24.16.0). The machine default is still Node 22, so every command must run with Node 24 on PATH: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`. Consider `nvm alias default 24` if this project becomes the primary one.
- **`.env.local` now exists** (gitignored) with *placeholder* Supabase values so the dev server boots and the workflow smoke run executes. Real anon/service keys from `supabase start` replace them at 5J.

## Done

- **5A — Bootstrap** (commit `ea8314d`). Next.js 16 + React 19 + Tailwind 4 + TypeScript 6 (strict), Biome, `next/font` for Mona Sans + IBM Plex Sans + IBM Plex Mono, `cacheComponents: true`, all design tokens from DESIGN_DIRECTION.md in `src/styles/globals.css` via `@theme inline`, Supabase scaffold (`supabase init`).
- **5B — Schema migrations** (commit `8d42d25`). 8 migration files, 764 lines of SQL covering every table from SYSTEM_DESIGN.md. Partitioned `audit_log` + `stock_movements` with 2026 + 2027 + default partitions. Enums, `updated_at` triggers, `token_generation` bump trigger on `tenant_members`, operational indexes, RLS enabled.
- **5C — RLS + auth scaffold** (commit `4578ebc`). `jwt_tenant_id`, `jwt_role`, `jwt_token_generation`, `has_role`, `is_owner`, `is_token_stale` helpers. Full RLS policy matrix for 34 tables. `custom_access_token_hook` registered in `supabase/config.toml`. `@supabase/ssr` clients (server / browser / middleware). `src/proxy.ts` with explicit defense-in-depth disposition (per `vercel-plugin:routing-middleware` skill: proxy is NOT sole auth gate; RLS + layout-server-check are the primary gates).
- **5D — SourceAdapter contract** (commit `89d378d`). `SourceAdapter` TypeScript interface, canonical zod schemas per `EntityKind`, `RetryableError` + `FatalError` taxonomy, `Cursor`, `AdapterCapabilities`, `PullResult`, `PushResult`, `CanonicalPayload`, `CANONICAL_SCHEMA_VERSION` constant, `canonicalSchemasByKind` registry.
- **5E — Workflow DevKit + smoke workflow** (2026-05-31). Invoked `vercel-plugin:workflow` skill first per standing rule. Installed `workflow@4.2.6` + `@workflow/next` + `@workflow/ai` (Node 24). Wrapped `next.config.ts` with `withWorkflow()`. Added `{ "name": "workflow" }` to tsconfig plugins. **Added `.well-known/workflow/` to the `proxy.ts` matcher exclusion** (REQUIRED — Workflow DevKit posts internal run-dispatch requests there; the Next 16 proxy footgun documented in the bundled setup doc). Smoke workflow at `src/workflows/smoke.ts`: `foundationSmokeWorkflow` orchestrator (`"use workflow"`) → `echoStep` + `summarizeStep` (`"use step"`), boundary respected (orchestrator pure, all I/O incl. clock in steps). Dev-gated trigger route at `src/app/api/smoke/route.ts` (404 in production; **note: folder must be `smoke` not `_smoke` — underscore = App Router private/non-routable**). **Verified:** `npx workflow health` → workflow + step endpoints healthy; `POST /api/smoke` → HTTP 200 `{ok:true,seed:21,doubled:42,summary:...}` with both step logs firing on separate requests; `npm run build` clean (workflow internal routes registered in route table); typecheck clean. **Incidental fix:** `biome.json` was on the 1.x schema while Biome 2.4.16 was installed — lint had been silently broken since 5A (typecheck was the only real gate). Ran `biome migrate`, added `css.parser.tailwindDirectives: true` for Tailwind v4 `@theme`, reformatted 6 files, scoped a `biome-ignore` on the WCAG reduced-motion `!important` reset. **`npm run lint` now exits 0.** Commit `<pending>`.

## Remaining

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

- Local git initialized at `projects/the-chain/`. Five commits (5A–5E). Nothing pushed (first push gated behind Codex full-weight review at 5J per PROCESS.md Hard Rule 9).
- `node_modules/` installed (now includes Workflow DevKit). Lint + typecheck + build all clean on Node 24.
- `supabase/` scaffolded but `supabase start` NOT yet run (defer until 5J or as needed for 5F/5I testing).
- `.env.local` exists with **placeholder** Supabase values (gitignored). Real keys from `supabase start` land at 5J.
- Node 24 must be on PATH for all commands (see Environment note at top).
