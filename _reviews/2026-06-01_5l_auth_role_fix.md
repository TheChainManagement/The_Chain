# Codex Review — 5l_auth_role_fix
**Date:** 2026-06-01 20:11
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 5 (Foundation)
**Unit reviewed:** 5l_auth_role_fix
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- `supabase/migrations/20260601130000_auth_role_claim_fix_5l.sql:25-70` fixes the actual collision. `custom_access_token_hook()` now writes the member role to `tenant_role` instead of the reserved top-level `role`, and `jwt_role()` now reads `auth.jwt() ->> 'tenant_role'`.
- The 5J membership-integrity gate was kept intact inside the hook. The tenant claims are still only minted when a real `tenant_members` row exists for `(active_tenant_id, user)`; see `supabase/migrations/20260601130000_auth_role_claim_fix_5l.sql:43-57`.
- The test harness was updated to match the intended post-5L token shape. `tests/helpers/db.ts:31-44` now injects `role: 'authenticated'` plus `tenant_role: claims.role` instead of stuffing the member role into `role`.
- The bench gate itself was already scoped to the JWT tenant and still looks correct for this fix. `src/app/(app)/layout.tsx:39-53` reads `tenant_id` from verified claims and checks membership for that exact tenant before rendering the bench.

## What wasn't done

- The claimed 5L evidence trail is missing. `_reviews/2026-05-30_phase5_progress.md:36` claims “Live browser: fresh sign-in reaches the Working Bench (screenshot evidence),” but there is no 2026-06-01 screenshot or 5L evidence file on disk. The only bench screenshot present is `_reviews/2026-05-31_5h_working_bench.png`, which predates the bug and proves nothing about the fix.
- The claimed “applied local + hosted via MCP `apply_migration`” is not evidenced on disk. `_reviews/2026-05-30_phase5_progress.md:31` says it happened; no migration log, no hosted artifact, no review evidence file backs it up.
- The claimed “80/80 tests green, typecheck/lint/craft clean” for 5L is not evidenced on disk. `_reviews/2026-05-30_phase5_progress.md:36` states it, but the only saved verification artifact is `_reviews/2026-05-31_5i_verify_foundation.txt`, which is from before 5L.
- The required Codex checkpoint artifact for this change did not exist before this run. `_reviews/2026-05-30_phase5_progress.md:38` explicitly says the 5L `moretech-codex-review` was still pending, and `PROCESS.md:175-176,255` makes that checkpoint mandatory for Phase 5 code changes.

## What can be done better

- Add a regression that asserts the full hook output shape, not just `tenant_id`. `tests/foundation/claim-integrity.test.ts:22-30` only extracts `tenant_id`, and `:69-85` only asserts presence/absence of that claim. It never checks that the hook emits `role='authenticated'` and `tenant_role='<member role>'`, which is the whole point of 5L.
- Add one integration test that exercises the real failure path: minted auth token -> PostgREST/Supabase request -> bench gate query. Right now the harness still short-circuits reality by doing `set local role authenticated` and injecting `request.jwt.claims` directly in `tests/helpers/db.ts:31-44`. That is exactly the blind spot that let this bug ship.
- Update stale contract comments. `supabase/migrations/20260530121200_init_auth_hook.sql:5` still says the hook “Adds tenant_id, role, token_generation custom claims,” which is now false. Leaving the old contract text around is how someone reintroduces the bug later.
- Stop using old screenshots as cover for new auth claims work. 5L changed auth semantics, not cosmetics. Reusing `_reviews/2026-05-31_5h_working_bench.png` is weak evidence for a production auth repair.

## What was missed

- The original implementation missed a basic platform constraint: PostgREST reserves the top-level JWT `role` claim for `SET ROLE`. That was not an edge case. That was the auth path.
- The review and test strategy still missed the exact production failure mode. 5J had already been burned for testing claim logic by injecting JWTs, and 5L still does not add a saved regression that proves a real auth token can survive an authenticated PostgREST request.
- The evidence discipline was missed again. The progress doc makes strong claims about hosted apply, live browser verification, and clean gates, but the repo does not contain matching 5L artifacts. In this process, undocumented verification is not verification.
- The contract/doc sweep was missed. The code changed the claim shape from `role` to `tenant_role`, but the older auth-hook migration header still documents the superseded shape. That is exactly the kind of stale guidance that causes silent regressions.
