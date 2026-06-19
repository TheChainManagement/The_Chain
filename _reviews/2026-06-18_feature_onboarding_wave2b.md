# Block 2 Wave 2b — onboarding QBO + CSV in-chain

Date: 2026-06-18
Status: BUILT. CSV path live-verified end to end; QBO path verified through
connect-initiation (full consent → sync is MG's Intuit-login acceptance step, per
the Block 6 precedent — NOT claimed as full live verification). Codex round-1
applied. Push pending.

## What shipped
The QBO and CSV onboarding paths now run IN the flow instead of handing off to
`/integrations` and `/import`. The chain fills in place.

- **Path-picker** (`PathPicker.tsx`): all three options now stay on `/onboarding`
  (no deep-link); picking refreshes and the matching inline panel renders.
- **QBO** (`OnboardingQboPanel.tsx`): reuses the Block 6 actions
  (`startQboConnect` → OAuth, `runQboInitialSync` → durable workflow,
  `getQboSyncProgress` → poller). Not-connected → "Connect QuickBooks"; connected
  → "Pull my data" runs the sync with a live phase tracker (Catalog → Suppliers →
  Sales lighting from the workflow cursor), then refreshes and the chain advances.
- **OAuth callback** (`api/qbo/oauth/callback/route.ts`): returns to `/onboarding`
  (not `/integrations`) when the operator is mid-QBO-onboarding, and stamps
  `onboarding_state.source_connected_at` so the Source link is definitively lit.
- **CSV** (`OnboardingImportPanel.tsx`): embeds the Block 5 `ImportWorkbench`
  (products / suppliers / sales lanes) as-is — same upload → map → preview →
  commit, no duplication — plus a "Continue setup →" that refreshes so the chain
  advances from the real counts.
- **Page** (`onboarding/page.tsx`): renders the QBO panel or the CSV workbench for
  the import paths (loads QBO connected/configured only when path=qbo, import
  specs only when path=csv).
- Pure helper `qboPhaseStage` extracted to `lib/onboarding/state.ts` (unit-tested)
  for the live phase→stage mapping; unknown phases fall back to stage 0.

No DB migration. No new engine — Wave 2b is wiring the existing, already-tested
QBO sync + CSV import into the onboarding chain.

## Tests
- `tests/onboarding/state.test.ts` +2 cases: `qboPhaseStage` maps each phase +
  falls back on unknown. **Suite 608/608**, tsc + biome + next build clean.

## Live verification (dev :3100, local Supabase)
- **CSV path — FULL end to end** (tenant CSV Inline Co): signup → pick spreadsheet
  → embedded `ImportWorkbench` on `/onboarding` → imported 2 products (lane 1) →
  Continue setup → chain 1/5 → **3/5** (Source + Catalog lit; csv source_connection
  active) → switched to Suppliers lane → imported 1 supplier → chain **4/5** →
  "Run my first forecast" → `/today`. DB: path=csv, completed_at set, 2 products /
  1 supplier / csv source_connection active / 2 forecasts. Source lit from the
  connection count (source_connected_at not stamped for csv — belt-and-suspenders).
- **QBO path** (tenant QBO Inline Co): signup → pick QuickBooks → inline panel
  renders ("QuickBooks Online", connect copy, "Connect QuickBooks") → click →
  `startQboConnect()` ran (200) → redirect to Intuit initiated (button → "Opening
  QuickBooks", no error). **Full consent → return-to-/onboarding → live sync is
  MG's Intuit-login acceptance step** (standing QBO precedent from Block 6); the
  callback's onboarding-redirect + source stamp are code-complete and exercise on
  that consent.
- Zero console errors across both runs.

## Deferred / ticketed (carried from Wave 2a + 2b)
- Playwright 3-state capture (infra-blocked; RTL artifact + live runs stand in).
- Action-layer integration tests for the onboarding actions.
- `minimum_fields_met` jsonb population.
- QBO full-consent acceptance in onboarding (MG Intuit login).
