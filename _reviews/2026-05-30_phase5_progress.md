# Phase 5 Foundation — Progress (updated 2026-05-31)

Six sub-phases complete, four remaining. Resume by reading this file + `FEATURES.md` §Wave 1 Foundation block, then continue at 5G.

## Container runtime note (2026-05-31)

- **No Docker Desktop. Local stack runs on Colima** (`brew install colima docker`, `colima start --cpu 4 --memory 6 --disk 60`). Docker context is `colima`. If `docker info` fails in a new shell, run `colima start`.
- **Supabase analytics/vector container is DISABLED** in `supabase/config.toml` (`[analytics] enabled = false`) — it bind-mounts the Docker socket, which Colima rejects. Not needed locally.
- Local stack commands need Homebrew bin on PATH: `export PATH="/opt/homebrew/bin:$PATH"` (for `supabase`/`docker`/`colima`).
- Local stack URLs: API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio `http://127.0.0.1:54323`. Keys are in `.env.local` (gitignored).

## Environment note (2026-05-31)

- **Node 24 is required and was installed via nvm** (`nvm install 24` → v24.16.0). The machine default is still Node 22, so every command must run with Node 24 on PATH: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`. Consider `nvm alias default 24` if this project becomes the primary one.
- **`.env.local` now exists** (gitignored) with *placeholder* Supabase values so the dev server boots and the workflow smoke run executes. Real anon/service keys from `supabase start` replace them at 5J.

## Done

- **5A — Bootstrap** (commit `ea8314d`). Next.js 16 + React 19 + Tailwind 4 + TypeScript 6 (strict), Biome, `next/font` for Mona Sans + IBM Plex Sans + IBM Plex Mono, `cacheComponents: true`, all design tokens from DESIGN_DIRECTION.md in `src/styles/globals.css` via `@theme inline`, Supabase scaffold (`supabase init`).
- **5B — Schema migrations** (commit `8d42d25`). 8 migration files, 764 lines of SQL covering every table from SYSTEM_DESIGN.md. Partitioned `audit_log` + `stock_movements` with 2026 + 2027 + default partitions. Enums, `updated_at` triggers, `token_generation` bump trigger on `tenant_members`, operational indexes, RLS enabled.
- **5C — RLS + auth scaffold** (commit `4578ebc`). `jwt_tenant_id`, `jwt_role`, `jwt_token_generation`, `has_role`, `is_owner`, `is_token_stale` helpers. Full RLS policy matrix for 34 tables. `custom_access_token_hook` registered in `supabase/config.toml`. `@supabase/ssr` clients (server / browser / middleware). `src/proxy.ts` with explicit defense-in-depth disposition (per `vercel-plugin:routing-middleware` skill: proxy is NOT sole auth gate; RLS + layout-server-check are the primary gates).
- **5D — SourceAdapter contract** (commit `89d378d`). `SourceAdapter` TypeScript interface, canonical zod schemas per `EntityKind`, `RetryableError` + `FatalError` taxonomy, `Cursor`, `AdapterCapabilities`, `PullResult`, `PushResult`, `CanonicalPayload`, `CANONICAL_SCHEMA_VERSION` constant, `canonicalSchemasByKind` registry.
- **5E — Workflow DevKit + smoke workflow** (2026-05-31). Invoked `vercel-plugin:workflow` skill first per standing rule. Installed `workflow@4.2.6` + `@workflow/next` + `@workflow/ai` (Node 24). Wrapped `next.config.ts` with `withWorkflow()`. Added `{ "name": "workflow" }` to tsconfig plugins. **Added `.well-known/workflow/` to the `proxy.ts` matcher exclusion** (REQUIRED — Workflow DevKit posts internal run-dispatch requests there; the Next 16 proxy footgun documented in the bundled setup doc). Smoke workflow at `src/workflows/smoke.ts`: `foundationSmokeWorkflow` orchestrator (`"use workflow"`) → `echoStep` + `summarizeStep` (`"use step"`), boundary respected (orchestrator pure, all I/O incl. clock in steps). Dev-gated trigger route at `src/app/api/smoke/route.ts` (404 in production; **note: folder must be `smoke` not `_smoke` — underscore = App Router private/non-routable**). **Verified:** `npx workflow health` → workflow + step endpoints healthy; `POST /api/smoke` → HTTP 200 `{ok:true,seed:21,doubled:42,summary:...}` with both step logs firing on separate requests; `npm run build` clean (workflow internal routes registered in route table); typecheck clean. **Incidental fix:** `biome.json` was on the 1.x schema while Biome 2.4.16 was installed — lint had been silently broken since 5A (typecheck was the only real gate). Ran `biome migrate`, added `css.parser.tailwindDirectives: true` for Tailwind v4 `@theme`, reformatted 6 files, scoped a `biome-ignore` on the WCAG reduced-motion `!important` reset. **`npm run lint` now exits 0.** Commit `a06fe28`.

- **5F — Audit log triggers** (2026-05-31). Single security-definer dispatcher `public.capture_audit()` in `supabase/migrations/20260531120000_audit_log_triggers.sql`, attached to all 13 tracked tables via a `do` loop (add a table = add to the array; no per-table code, satisfies the Codex "single dispatcher" check). Captures full-row `before`/`after` jsonb so Wave 6 ROI fields are always present; strips secrets by name denylist (`encrypted_credentials` et al). **Two real bugs found by standing up Postgres for the first time:** (1) 5B migration `supplier_scorecards` had a column literally named `window` (reserved word) → renamed `window_kind` in `20260530120300_init_procurement.sql`; the whole suite had never run against real PG before. (2) Partitioned-table gotcha: trigger on `stock_movements` fires on the routed partition so `tg_table_name` was `stock_movements_2026` → fixed with `pg_partition_root(tg_relid)` to resolve the logical parent (returns NULL for plain tables, coalesce to `tg_table_name`). **Test harness established (Vitest + `pg`, which 5I extends):** `vitest.config.ts`, `tests/helpers/db.ts`, `tests/foundation/audit-triggers.test.ts` — 20 tests, all green. Covers: audit row on every tracked table's insert + "13 and no others", ROI fields for inventory_levels/purchase_orders/stock_movements, update before/after, delete before/null, redaction of `encrypted_credentials`. Runs in one rolled-back tx (DB untouched). Added `npm test` script. `npm run build` + typecheck + lint all clean. Commit `<pending>`.

## Remaining

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

- Local git initialized at `projects/the-chain/`. Six commits (5A–5F). Nothing pushed (first push gated behind Codex full-weight review at 5J per PROCESS.md Hard Rule 9).
- `node_modules/` installed (Workflow DevKit + Vitest + pg). Lint + typecheck + build + `npm test` all clean on Node 24.
- **`supabase start` IS running now** (Colima). Full migration suite applies clean (5B–5F). `supabase db reset` re-applies from scratch. `.env.local` has the real local keys + `SUPABASE_DB_URL`.
- Node 24 must be on PATH for app/test commands; Homebrew bin on PATH for supabase/docker/colima (see notes at top).
