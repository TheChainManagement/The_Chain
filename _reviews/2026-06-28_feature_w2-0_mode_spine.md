# W2-0 — Operating-mode spine (evidence)

Date: 2026-06-28. Wave 2, first build. Design: `docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md` (MG-approved).

## What shipped (the spine only)

1. **Migration** `supabase/migrations/20260628120000_w2_operating_mode.sql` — additive: new
   `operating_mode` enum (`distribution|storeroom|food`) + `tenants.operating_mode` column,
   `not null default 'distribution'`. Every existing tenant reads as the Wave-1 baseline, no
   backfill. Verified live in the local DB (column type `operating_mode`, default
   `'distribution'`, enum values `distribution,storeroom,food`).
2. **Profile registry** `src/lib/modes/` (the source of truth, pure data, no engine coupling):
   - `types.ts` — `OperatingMode`, `DemandArchetype`, `NavHref`, `OperatingProfile`.
   - `profiles.ts` — three seed profiles + `getProfile()` (null/unknown → default) + `allProfiles()`.
   - `resolver.ts` — `server-only` `loadOperatingMode()` / `loadOperatingProfile()`, mirroring
     `loadSubscription` (service-role admin read, tenant-scoped, throws on real error).
3. **Wiring** — `(app)/layout.tsx` resolves the mode in BenchGate and passes it to `LeftRail`;
   `LeftRail` applies the profile's per-mode nav labels and renders a mode badge under the brand.
4. **Visible delta** — a mode badge ("DISTRIBUTION · demand from sales" etc.) plus the `/inventory`
   nav slot refit per industry: Distribution → "Inventory", Storeroom → "Storeroom", Food → "Stock".

The forecast / policy / reorder engine is untouched (mode-agnostic by design). Nothing is hidden
yet (`hiddenNav` empty for all profiles) — mode-specific surfaces arrive in W2-2.

## Scope honesty

This is the spine ONLY: the mode column + registry + resolver + nav/terminology. Storeroom
issue-out (`issue_out`/`issue_return` enum + the `demand_ref` envelope + `location_kind`, per design
§10) is **W2-2**, not in this slice.

## Gates (all green)

- `tsc --noEmit` — clean.
- `biome check src` — clean.
- `check:craft` — PASS (token discipline + trust hierarchy intact).
- `next build` — clean (exit 0).
- Unit + RTL: `tests/modes/profiles.test.ts` (6) + `tests/modes/left-rail.test.tsx` (3) = **9/9**.
  The RTL test is the memorable artifact: it renders the REAL `LeftRail` for all three modes and
  asserts the badge text + the relabeled inventory link, so the visible delta can't silently regress.
- Full unit suite: 607 passed.

## Known-environmental (NOT caused by this change)

- **47 DB-integration tests fail** in this local session. Root cause: the local Supabase GoTrue
  auth API is broken here — the tests' setup calls `admin.auth.admin.createUser(...)` and gets
  `AuthRetryableFetchError`, cascading into `null tenant_id` / `invalid uuid` errors. **Proven
  pre-existing:** with this change stashed (clean main), `tests/scorecards/receive.test.ts` still
  fails 4/5 identically. None of the 47 import any W2-0 file; zero failures mention `operating_mode`.
  Same class as the repo's documented local-drift lesson. Expected green in a healthy env / CI.
- **Live authed browser screenshot deferred** — the same GoTrue breakage blocks the UI `signUp`
  path (signup form stays put, no session minted), so an authed bench screenshot isn't attainable
  in this session. The RTL memorable test stands in for the visible behavior (repo precedent for
  infra-blocked capture). Offer: MG acceptance once local auth is healthy, or it'll screenshot on a
  Preview deploy.

## Next

- MG review of this checkpoint → `moretech-codex-review` gate → push (MG-gated).
- Then W2-1 (data-model cleanup) → W2-2 (storeroom issue-out).
