# The Chain: W2-4 Multi-location Design

Status: signed off by MG, 2026-07-14

Sources: `FEATURES.md` W2-4 forward contract, `docs/WAVE2_SCOPE.md` section 4,
the shipped posting kernel, and the existing location-aware forecast, policy, reorder,
procurement, PO, hold, and count data paths.

## 1. Outcome

W2-4 completes Wave 2 by letting an operator run more than one physical location without
mixing stock, recommendations, documents, or transfers between them.

The shipped schema is already location-aware, but the current product behaves as a
single-location application in several important places. W2-4 must activate the existing
dimension as an end-to-end operating boundary, not add a cosmetic filter.

## 2. Audit finding: the hidden prerequisite

There is currently no operator-facing path to create or manage a second location. Onboarding
and imports ensure a primary location exists, while storeroom actions and cycle counts resolve
that primary location automatically. A global selector by itself would therefore be incomplete.

W2-4 needs a small location-management surface before the selector can be useful:

- list active locations;
- create a location with name, type, and location kind;
- rename or archive an unused location;
- prevent deletion or archival that would strand stock or open documents;
- retain one primary/default location for imports and backward-compatible flows.

This is the only new prerequisite found. The database model, composite location FKs, posting
kernel, per-location policy rows, reorder partitioning, and procurement document location
snapshots already provide a strong base.

## 3. Recommended scope model

Use one shared location scope in the authenticated bench shell.

- `All locations` is the default read scope.
- A specific location is an explicit operating scope.
- The selection is encoded in the URL as `?location=<uuid>` so links are shareable, refreshes
  are stable, and server components do not depend on hidden client state.
- Invalid or cross-tenant location IDs fall back to `All locations` and never widen RLS.
- The selector is visible only when the tenant has at least two active locations. A one-location
  tenant keeps today's quiet interface.

`All locations` is valid for aggregate reading only. Any write that changes physical stock or
creates a location-bound document must name one concrete location.

## 4. Surfaces activated in W2-4

### Inventory and dashboard

- Inventory list totals aggregate across active locations in `All locations` and filter to one
  location when selected.
- Product detail keeps its location breakdown and emphasizes the selected row.
- Dashboard metrics, alerts, valuation, and inventory status honor the selected scope.
- Hold, release, issue, adjust, and cycle-count actions require a concrete location. In
  `All locations`, the action opens with a required destination/location choice.

### Forecast, policy, and reorder

- Forecast recompute accepts an authorized explicit location and no longer rejects it as a
  future feature.
- Policy and recommendation rows remain partitioned by `(tenant, product, location)`.
- Reorder queue filters by selected location while retaining separate location groups in
  `All locations`.
- RFQs created from recommendations inherit exactly one location. Mixed-location selections
  cannot enter one RFQ.

### Procurement and purchase orders

- RFQ, requisition, and PO benches filter by scope.
- New RFQs and direct PO flows always display their concrete destination location.
- Existing document location snapshots never change when the global selector changes.
- Receipt and approval continue to post only to the PO's stored location.

## 5. Transfers

Add a transfer recommendation and execution flow for moving stock from a surplus location to a
short location.

### Recommendation contract

A recommendation is eligible only when:

- source and destination are different active locations in the same tenant;
- destination is below its reorder point or safety target;
- source has enough available, unheld stock above its own safety target;
- suggested quantity is capped by both destination need and source transferable surplus.

Recommendations are advisory. They do not reserve or mutate stock.

### Atomic posting contract

Acting on a recommendation calls one transaction-bound database RPC that:

1. verifies tenant membership and an authorized operator role;
2. row-locks both inventory-level rows in deterministic location-ID order;
3. recalculates available source stock and rejects stale or excessive quantities;
4. posts a negative `transfer_out` at the source through the posting kernel;
5. posts an equal positive `transfer_in` at the destination through the posting kernel;
6. stamps both ledger rows with one transfer reference and actor;
7. rolls back both sides if either posting fails.

The quantity is expressed in stock UoM. Transfers do not change moving-average unit cost or
tenant-wide inventory value.

## 6. Permissions and safety boundaries

- Owner, manager, and warehouse may execute transfers and physical stock actions.
- Planner may view all locations, recommendations, and documents but cannot move stock.
- Location IDs are verified against the JWT tenant at the database boundary.
- No direct member write to `inventory_levels` is restored.
- Source and destination cannot match.
- Held and allocated quantities are never transferable.
- Archived locations remain readable in historical documents but cannot receive new activity.

## 7. Location lifecycle recommendation

Reuse the existing `locations.active boolean not null default true`, add
`locations.is_primary boolean not null default false`, and add a tenant-scoped partial unique
index for active normalized names. Do not hard-delete locations in the application.

Archival is blocked while the location has any non-zero on-hand, held, allocated, or in-transit
position, an open PO, an open RFQ/requisition, or an open cycle count. The existing primary
location cannot be archived until another active location is made primary.

Add one explicit primary marker rather than relying on name or lowest UUID. Imports, QBO sync,
and legacy actions use this primary location only when the caller has not supplied a concrete
location.

## 8. Build slices

1. **W2-4a - location contract:** lifecycle columns, tenant constraints, primary-location RPC,
   location management UI, role and cross-tenant probes.
2. **W2-4b - shared scope:** URL-backed selector in the bench shell, inventory/dashboard/query
   filtering, one-location suppression, invalid-scope behavior.
3. **W2-4c - operating surfaces:** explicit locations for storeroom actions and cycle counts;
   location-scoped forecast, policy, reorder, procurement, and PO benches.
4. **W2-4d - transfers:** recommendation transform, atomic transfer RPC, execution UI, paired
   ledger trail, concurrency and rollback probes.
5. **Review and production gate:** clean migration replay, full suite, visual walkthrough,
   adversarial tenant/location review, then MG-authorized production migration and merge.

## 9. Acceptance criteria

- [ ] A tenant can create and manage a second active location without database access.
- [ ] One-location tenants retain the current quiet shell.
- [ ] `All locations` aggregates reads but never permits an ambiguous physical write.
- [ ] Specific-location scope reaches dashboard, inventory, valuation, forecast, policy,
      reorder, procurement, purchase orders, holds, issues, adjustments, and counts.
- [ ] Recommendation and procurement groups never mix locations into one destination document.
- [ ] Transfer recommendations respect available unheld stock and both locations' policy targets.
- [ ] Transfer execution creates equal paired kernel postings atomically and is concurrency-safe.
- [ ] Transfers preserve total tenant quantity and value.
- [ ] Archived or cross-tenant locations cannot receive new activity.
- [ ] RLS, role matrix, URL tampering, stale recommendation, and same-location probes pass.
- [ ] Full automated suite, TypeScript, Biome, craft, clean migration replay, and production
      security probes are green.

## 10. Memorable interaction

The location selector is a compact chain junction in the bench header. In `All locations`, it
shows the network as one system. Selecting a site tightens the bench to that physical node.

The transfer tray makes the balancing logic visible: a source bar gives up only its safe surplus,
a destination bar fills only to its target, and the center link states the exact stock-UoM move.
When posted, the one link resolves into matched `OUT` and `IN` ledger stamps with a shared
reference. The visual must explain that inventory moved, but none was created or destroyed.

## 11. MG decisions locked 2026-07-14

1. **Scope persistence:** URL query parameter.
2. **Default read scope:** `All locations`.
3. **Location lifecycle:** archive-only with blocking checks.
4. **Transfer execution:** immediate atomic move for Wave 2.
5. **Location assignment permissions:** tenant-wide roles for Wave 2. Per-location role
   assignment remains with the full Wave 3 role build.

## 12. Explicit deferrals

- transfer orders with pick, ship, receive, discrepancy, and in-transit stages;
- per-user location memberships and location-specific role grants;
- route optimization, truck scheduling, and intercompany transfers;
- per-location ABC/XYZ classification until enough location-specific demand exists;
- automatic transfer execution;
- the four W2-3 fast-follow tickets in `_reviews/_tickets.md` unless MG separately promotes one.
