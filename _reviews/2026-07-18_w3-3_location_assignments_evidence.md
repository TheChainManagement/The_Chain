# W3-3 location assignments evidence — 2026-07-18

## What was done

- Added `tenant_members.all_locations` with a true/default backfill and the composite-keyed
  `tenant_member_locations` table.
- Added current-database `can_access_location()` enforcement, guarded assignment replacement,
  owner/manager all-location rules, lower-role hierarchy, active-location validation, final
  assignment protection, and audit triggers.
- Replaced location-scoped RLS across the operational graph: locations, inventory, movements,
  classification, forecasts, policy, recommendations, POs/lines/receipts/performance, cycle counts,
  RFQs/quotes, requisitions, and transfers.
- Applied the same primitive before service-role movement posting, transfer posting, reorder
  conversion, cycle-count close, and synchronous/durable movement imports.
- Added Team assignment controls and allowed the existing rail query to collapse naturally to only
  RLS-authorized locations. “All locations” therefore means all authorized locations.

## What wasn’t done

- W3-4 shared planning and W3-5 spend-policy configuration were not started.
- No production migration or deploy was performed.
- Tenant-global supplier scorecards and catalog master data remain tenant-wide by design; they do
  not carry a trustworthy location key. Tenant-wide forecast/classification aggregates are hidden
  from scoped members, while all-location members retain them.

## What can be done better

- Add explicit location selection to stock-movement CSV import; this slice safely selects the
  caller's primary/first authorized active site.
- Add a small assignment summary to read-only self settings so a member can see who controls their
  scope without entering the admin-only Team page.
- Consider whether future managers may be scoped. This slice keeps managers company-wide because
  they administer locations and lower-role assignments.

## What was missed

- The first service-path inventory review showed that service-role writers bypass RLS by design;
  enforcing only table policies would have left transfer, storeroom, reorder conversion, count
  close, and CSV movement paths broader than intended.
- Durable imports initially had no actor or authorized location after detaching from the session;
  W3-3 now resolves the site through RLS before starting and carries that immutable location ID.

## Verification evidence

- `supabase db reset`: all migrations through `20260718130000_w3_3_location_assignments.sql`
  replayed successfully.
- Focused final Vitest: 28 W3-0 through W3-3 database/RPC tests green plus 17
  switch/password/location tests; the expanded W3-3 database suite is 7/7 green.
- Browser: owner Team page rendered the all/selected radio group and two site checkboxes; scoped
  planner rail exposed only North Warehouse (single-site quiet shell), not South Yard; console had
  zero errors.
- Taste-skill evidence: reused the established square panels, hairline borders, mono uppercase
  labels, tokenized colors, compact checkbox junction, and responsive one-column form. No new
  gradients, rounded-card language, type families, or competing navigation patterns were added.

## Final gate

- `npm run typecheck`: green.
- `npm run lint`: 358 source files green.
- `npm run check:craft`: token discipline and trust hierarchy green.
- `npm test`: 137 files, 962 tests green.
- `npm run build`: optimized Next.js production build green; 58 static pages generated.
- Final `supabase db reset`: green through both W3-2 review hardening and W3-3 migrations.
