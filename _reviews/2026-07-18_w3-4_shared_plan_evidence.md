# W3-4 shared plan + role-emphasized Today evidence — 2026-07-18

## What was done

- Added a pure 30-day coverage calculator and RLS-scoped live read model over active products,
  authorized locations, inventory levels, latest promoted forecast points, and committed PO lines.
- Added `/plan` with the timestamp, visible scope/denominator, primary coverage number, uncovered
  demand and value, inventory value, open commitment, top SKU/location gaps, forecast-quality count,
  confirmed incoming, and unvalued-gap disclosure.
- Added Plan to every role's rail and capability-selected read-through links without adding any new
  write or Server Action surface.
- Kept `/today` as one tree and added owner/manager, planner, warehouse, finance, and viewer emphasis
  from the same plan snapshot. Every fact link preserves the authorized location query.

## Coverage semantics

- Physical ATP is `netPosition(level) - in_transit`, floored at zero. `netPosition` remains the
  canonical source for held/allocated semantics.
- Confirmed incoming is the remaining stock-UoM quantity on approved/exported/sent/partial-received
  POs due before the exclusive 30-day horizon end. Approved PO quantities already populate
  `inventory_levels.in_transit`, so removing that bucket before adding due lines prevents a double
  count and excludes undated/out-of-horizon supply.
- Open PO commitment includes all remaining purchase-UoM quantities on committed POs multiplied by
  their snapshotted unit cost, regardless of whether delivery falls inside the coverage horizon.
- The newest promoted forecast per SKU/location drives demand. A tenant-wide forecast maps only to
  the primary authorized location, matching the existing policy fallback. Usable zero demand is
  distinct from missing points: the former says “No planned demand”; the latter increments the
  excluded data-quality count.

## What wasn't done

- No durable weekly plan snapshots, comments, meeting sign-off, consensus workflow, or scenario
  versioning were added; the signed design explicitly starts with a live read model.
- W3-5 owner-configured approval policies and spend limits were not started.
- No production migration or deploy was performed. W3-4 requires no schema migration.

## What can be done better

- Add a purpose-built SQL read view if real tenant scale shows too many forecast-point batches; the
  first slice keeps calculation logic pure and visible while limiting point reads to the latest
  promoted bundle in batches of 200.
- Add an uncosted stocked-SKU count beside inventory value. The plan already surfaces unvalued gap
  units, but inventory value can still be incomplete when moving-average cost has not been seeded.
- The global mobile bench rail predates W3-4 and remains vertically expensive at phone width; the
  new plan itself collapses cleanly, but a later shell pass should turn the rail into a compact
  mobile navigation treatment.

## What was missed and corrected during the pass

- The canonical position helper includes `in_transit`; adding PO lines directly would have counted
  approved supply twice. The final calculator explicitly removes that bucket first.
- A selected non-primary location initially inherited a tenant-wide forecast because it was the only
  location in the request. The fallback now requires the actual `is_primary` flag.
- Fractional purchase-to-stock factors initially risked being forced to one. Positive factors now
  pass through exactly; only null/zero invalid inputs fall back to one.
- The first desktop visual pass showed an empty-value dash and a wrapped fourth metric. The final
  surface uses an explicit `NO DEMAND` state and keeps the four shared facts on one border-divided
  strip at desktop width.
- The full gate exposed a latent W2-4 primary-location race: one multi-row UPDATE could set the new
  primary before clearing the old row under a non-deferrable partial unique index. The W3-4 review
  migration now locks the location set, clears the old unique slot, then sets the target inside the
  same RPC transaction.
- The dev log exposed an unauthenticated render race between the app layout redirect and the new
  child read model. `/plan` and `/today` now verify a tenant claim before issuing plan queries, so a
  direct anonymous visit redirects without a denied-RLS error in the server log.

## Verification evidence

- Focused Vitest: 12 plan/role/chrome tests green. Calculation cases cover double-count prevention,
  remainder valuation, status/horizon exclusion, latest forecast selection, primary fallback,
  selected non-primary behavior, zero-vs-missing demand, and fractional UoM conversion.
- Authenticated browser: local owner `mg-store@local.test` rendered the new Owner bench on `/today`
  and `/plan`. Real seeded data showed `No planned demand`, six excluded SKU-locations, 48 confirmed
  incoming stock units from the case-packed PO, and $480 open commitment. Desktop and 390px plan
  layouts were inspected; the console had zero warnings/errors.
- Taste-skill evidence: reused the Chain's flat clipped panels, border-divided metric strip, mono
  labels, semantic value tones, asymmetric main/rail composition, existing type/token system, and
  responsive single-column collapse. No dependency, gradient, rounded-card system, shadow language,
  fake value, or competing navigation pattern was introduced.

## Final gate

- `npm test`: 139 files, 970 tests green.
- `npm run typecheck`: green.
- `npm run lint`: 365 source files green.
- `npm run check:craft`: token discipline and trust hierarchy green.
- `npm run build`: optimized Next.js production build green; 59 static pages generated and `/plan`
  included in the route manifest.
- Final `supabase db reset`: every migration replayed successfully through
  `20260718140000_w3_4_primary_location_atomicity.sql`.
