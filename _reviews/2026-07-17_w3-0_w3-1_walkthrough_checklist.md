# W3-0 + W3-1 walkthrough checklist (2026-07-17)

Branch: `codex/w3-role-spine` (commits `1bb4707` W3-0, `762988e` W3-1)
Local: dev server on http://localhost:3100, local Supabase on :54321 (migrations applied).
Goal: prove the team-access + provisional-account gate before push. Nothing here touches prod.

## Pre-checks (already verified by Claude)
- tsc clean, biome clean.
- Access unit + component tests: 8/8.
- DB security probes (real Postgres): 15/15.
- `bootstrap_tenant` is SECURITY DEFINER, so signup still works after the policy drop.
- Migrations untracked before this branch was committed; prod unaffected.

## Walkthrough steps

### 1. Owner signup (also confirms the policy drop didn't break signup)
- Go to `/signup`. Create a workshop (business name + a real-ish email + password).
- Expect: the "workshop forming" transition, then you land on `/today` as owner.

### 2. Reach the Team bench
- Go to `/settings`. Expect a new **Team access** panel ("Manage team").
- Click through to `/settings/team`. Expect the member list (you, owner) and an empty pending list.

### 3. Create a provisional planner
- Enter a brand-new email (e.g. `planner+test@example.com`) and role **Planner**. Submit.
- Expect: a one-time credential card showing the email + a 20-char temporary password + expiry.
- Copy the password (you need it in step 5). It will not be shown again.
- Expect the planner to appear under pending access.

### 4. Confirm the provisional user is fenced out
- Sign out. Sign in with the planner email + the temporary password.
- Expect: redirect to `/activate-account`, NOT `/today`.
- Try to hit `/today` directly in the URL. Expect it to reject / bounce you (no tenant claim yet).

### 5. Forced password replacement + activation
- On `/activate-account`, set a new password (must be >= 6 chars; use one different from the temp).
- Submit. Expect activation to succeed and land you on `/today` as the planner.
- Expect the planner bench to hide owner-only nav (`/integrations`, `/settings`) per the role registry.

### 6. Back as owner: confirm the member moved from pending to active
- Sign back in as the owner. Go to `/settings/team`.
- Expect: planner now shows as an active member (not pending). Try a role change and a removal.
- Expect: you cannot change or remove your own owner row (self-mutation blocked).

## What to watch for (report anything off)
- Browser console errors at any step (I can pull `read_console_messages`).
- The temporary password appearing anywhere it shouldn't (network tab, logs, a second reveal).
- `/activate-account` letting you in without replacing the password.
- Any step where a planner can reach an owner-only action by direct URL.

## Known low-severity finding (not a blocker)
If in step 5 you set the new password EQUAL to the temporary one, activation may still succeed
(Supabase does not reject same-as-old by default). The account would keep a password the owner saw
once. Fix later: enforce Supabase "reject same password" or reject in the activation action.

## After a clean walkthrough
- Push `codex/w3-role-spine` to origin (side branch only, do NOT merge main).
- Then either W3-2 (tenant switch + role-aware chrome) or the same-password hardening fix.
