# The Chain: W2-0 Operating-Mode Spine — Design

Status: DRAFT for MG review. Precedes any Wave 2 code (per `WAVE2_SCOPE.md` §4, §5).
Authored 2026-06-28. No migration applied, no app code written yet.

This is the load-bearing decision for Wave 2: the spine that lets one engine run a
distribution business, a storeroom, a restaurant, and whatever the industry research adds,
without a refactor later.

---

## 1. Principle

1. **A mode is an inventory-FLOW archetype, not an industry label.** Many industries collapse
   to the same flow (an MRO storeroom, a hospital supply room, and a construction job-site all
   "issue material to a thing that consumes it"). We model the flow, then map industries to it.
2. **Modes are profile-driven and open-ended.** A mode is a declarative profile in code, not a
   pile of `if mode == 'storeroom'` branches. Adding a mode = adding a profile. The Perplexity
   industry research can therefore only ever ADD profiles; it can never force an engine rewrite.
3. **The engine is shared and mode-agnostic.** Forecast, policy, reorder, and scorecards do not
   know the mode exists. A mode adapts only two things: the INPUT (what counts as demand) and the
   material-flow SEMANTICS (which events exist and how stock moves).

This directly satisfies the build rule "wire for the full vision, release in waves."

---

## 2. The mode abstraction: an operating profile

Each profile is a declarative object carrying:

| Field | What it defines |
|-------|-----------------|
| `key` | stable id (`distribution`, `storeroom`, `food`, ...) |
| `label` + `industries` | display name + the industries that map to it |
| `demandSource` | which movement type(s) feed the forecast (`sale`, `issue`, `production_consumption`, ...) |
| `flowEvents` | the in/out/consume events this mode exposes (receive, pick/ship, issue-to-WO, adjust, cycle-count, transfer) |
| `terminology` | label map: sale vs issue vs consumption; customer vs work-order vs crew |
| `nav` | which surfaces/workflows show for this mode |
| `policyDefaults` + `uomConventions` | default reorder behavior + expected units |
| `extensions` (nullable) | mode-specific seams: expiration/lot/FEFO (food), BOM (manufacturing), par-levels (healthcare), serialization |

A tenant references a profile by `key`. Everything mode-dependent in the app reads the profile
through ONE resolver (`tenant -> profile`), never an inline mode check.

---

## 3. Seed profiles (3 now; open set)

| | **Distribution** | **Storeroom (MRO)** | **Food / perishable** |
|---|---|---|---|
| Industries | wholesale, resale, ecommerce | maintenance, facilities, construction, hospital supply | restaurant, grocery, pharmacy |
| Demand source | `sale` | `issue` (to work order / crew / cost center) | `issue` / depletion, expiration-aware |
| Primary out-event | pick + ship to customer | issue material out | consume, with FEFO |
| Special mechanics | (none new) | work-order ref (free-text now), requisition | lot/batch, expiration date, FEFO |
| Terminology | sale, customer, order | issue, work order, requisition | usage, batch, expiry |
| Build status | shipped (Wave 1) | **build this wave** | **architect-for now, full build later** |

Food's lot/expiration mechanics are the "whole different beast" MG flagged: the spine RESERVES
the extension seam now and we build it in a later wave.

---

## 3.5 Mode set validated + condensed by research (2026-06-28)

A Perplexity industry-flow study confirmed the spine and named the full future mode set. Its
biggest contribution: model by **demand object + custody object + traceability rules**, not by
industry. That matches this design and sharpens it.

**Refinement we adopt (a condensation of its "8 modes"):** the differences are NOT 8 monolithic
modes. They are a small set of DEMAND ARCHETYPES crossed with a few ORTHOGONAL LAYERS. A tenant's
"mode" is a named preset = (demand archetype + which layers are on).

Demand archetypes (what consumes inventory):
- **Sell** — demand = customer sales. (distribution, retail, ecommerce, apparel)
- **Issue** — demand = issue to a consuming object: work order, project/job, patient/case,
  department, par location. (MRO storeroom, construction, field service, healthcare)
- **Produce** — demand = production order consuming a BOM into finished goods. (manufacturing/WIP)

Orthogonal layers (stack onto any archetype):
- **Mobile/site** — the stocking location is movable (van, job-site). Multi-location + mobile, an
  axis, not its own mode. (field service, construction)
- **Traceability** — none / lot+expiry / serial / regulated chain-of-custody. (food, pharmacy,
  cannabis)
- **Transformation** — BOM / kitting / WIP. (manufacturing)

Why industries collapse: field service = Issue + Mobile. Construction = Issue (consuming object =
project) + Mobile/site. Pharmacy = Issue + lot/expiry traceability. Cannabis = Sell/Issue +
regulated traceability + transformation. Retail/ecommerce/apparel = Sell with a richer SKU model
(variants) and reservations, not a new flow.

**The consuming object is polymorphic** (sales order | work order | project | patient/case | par
location). That single idea is what keeps the mode count small. We adopt it (see §5).

**Wave 2 scope is UNCHANGED by this research.** We still build distribution (Sell, shipped) +
storeroom (Issue, this wave) + food (Sell/Issue + expiry, architect-for). The research's value is
(a) it validates the spine, (b) it names the future presets so the registry is shaped right now,
(c) it gives us the polymorphic-consuming-object pattern to adopt for storeroom's work-order issue.

---

## 4. The engine boundary (what stays shared, untouched)

The forecast reads a **normalized demand series**. Each profile produces that series from its own
`demandSource` movements:

- distribution: sum `sale` movements per period.
- storeroom: sum `issue` movements per period.
- food: sum consumption per period (expiration handling is a policy overlay, not a new forecast).

So the only mode-specific code is a thin **flow adapter** per profile that (a) maps raw operator
events to canonical `stock_movements`, and (b) emits the demand series. Policy, reorder point,
safety stock, scorecards, alerts, and the AI insight layer all consume the SAME canonical
`inventory_levels` + `inventory_policy` rows they do today. Zero engine change.

---

## 5. Data model

The spine is deliberately small:

- **`tenants.operating_mode`** — NEW column. `text` with a check constraint (or an enum), default
  `'distribution'`. Set by MG today; a future industry-selection setup step writes the same column.
  This is the ONLY new column the spine itself requires.
- **Profiles live in code**, not a DB table — a typed registry (`src/lib/modes/`). Versionable,
  testable, no migration per new mode. A tenant row only stores the `key`.
- **Movement enum gap (confirmed):** today's `stock_movement_type` enum is
  `sale, receipt, transfer_in, transfer_out, adjustment, cycle_count`. There is **no `issue`
  type.** Storeroom issue-out needs one of:
  - **(A)** add `'issue'` (and likely `'production_consumption'` for future manufacturing) to the
    enum — cleanest, makes the demand signal explicit and queryable. **Recommended.**
  - (B) reuse a signed `adjustment` with a work-order ref in metadata — no migration, but muddies
    "what is demand" and pollutes the adjustment audit story. Not recommended.
- **Food extensions** (lot, expiration columns/tables) are additive and built when food is built;
  the spine only reserves the seam, adds nothing now.
- **Consuming-object reference (adopt the pattern, implement minimally).** Storeroom issue-out must
  record WHAT consumed the stock (work order / crew / cost center). The research's polymorphic
  `demand_refs` (type + id) is the right long-term shape and generalizes to project, patient/case,
  production order. For THIS wave MG chose a FREE-TEXT work-order reference, so we implement the
  minimal version: a typed reference on the issue movement (`reference_type='work_order'`,
  `reference_value=<free text>`), shaped so it upgrades to the full ref table without a rewrite. Do
  NOT refactor Wave-1's ledger toward full polymorphic ref tables until a mode actually needs it.
- **Required-fields-as-data (reserve, do not build).** Lot is forbidden on office supplies,
  optional on resale, required on a reagent receipt. The long-term answer is a `field_rules` data
  table, not forked screens. We note the seam now; the profile registry's `extensions` field is the
  Wave-2 stand-in. Build the rules engine only when traceability modes arrive.

---

## 6. How it threads through the app

One resolver, read everywhere:

```
getOperatingProfile(tenant) -> Profile
```

- Nav/layout reads `profile.nav` to show the right surfaces.
- Copy reads `profile.terminology` (so "Sales" becomes "Issues" in storeroom without forked pages).
- The import + manual-entry flows write the profile's `flowEvents` to canonical movements.
- The forecast batch reads `profile.demandSource` to build the demand series.

No surface contains a raw `if (mode === ...)`. New mode = new profile object + its flow adapter.

---

## 7. Open / deferred (do NOT block this design on them)

- **Full future mode set (named by the 2026-06-28 research, build later as registry presets):**
  Sell (distribution / retail / apparel), Issue-storeroom (MRO), Issue-project (construction),
  Issue-clinical (pharmacy / labs; lot + regulated), Produce (manufacturing; WIP + BOM), with
  Mobile and regulated-traceability (cannabis) as layers / opt-in. Each is archetype + layers;
  none requires an engine change.
- **Self-serve industry-selection setup step:** design TBD (`WAVE2_SCOPE.md` §5). Today MG sets
  `operating_mode` manually from the customer call.
- **Food deep build** (lot/expiration/FEFO) and **manufacturing BOM:** later waves.

---

## 8. Why this is "right the first time"

Profile-driven config + a thin per-mode flow adapter means new industries never touch the engine.
The research can expand the mode set freely, food and manufacturing slot in through reserved
extension seams, and the shared forecast/policy/reorder brain is written once. That is the whole
point of doing the spine on paper before any W2-1 code.

---

## 9. Proposed build order once approved

1. `tenants.operating_mode` migration + the `src/lib/modes/` profile registry (distribution +
   storeroom + food seed profiles) + the `getOperatingProfile` resolver. (The spine itself.)
2. Wire nav + terminology through the resolver (distribution unchanged; storeroom relabels).
3. THEN W2-1 data-model cleanup, now done with the profile model in hand.
4. THEN W2-2 storeroom operations (issue-out), which is the first profile to exercise a non-sale
   demand source end to end.

---

## 10. Storeroom (W2-2) migration spec (2026-06-28 schema audit + condensation)

**Scope correction (2026-06-28):** the W2-0 SPINE shipped as just the `operating_mode` enum +
`tenants.operating_mode` column (§5) — that is all the spine needs. The migration below
(issue movement types + the demand-reference envelope + `location_kind`) belongs to **W2-2
storeroom operations**, NOT W2-0: those columns are dead until issue-out is built, and §9's build
order sequences storeroom as a later step. Keeping them here (not shipped in the W2-0 slice) avoids
dead schema. This section is the W2-2 spec.

A second Perplexity pass audited the Wave-1 schema and proposed a column set. It validated the
direction (add Issue movement types + a demand-reference envelope so storeroom issue is the first
instance of the polymorphic pattern, not a dead-end work-order special case). We CONDENSE its
column list to the minimal non-throwaway set.

### Add with W2-2 (the storeroom migration)
- **enum:** add `issue_out` and `issue_return` to `stock_movement_type`. `issue_out` = stock leaves
  a stocked location, relieved to a consuming object; `issue_return` = unused material comes back.
  Generalizes later to project / patient-case / par issue unchanged.
- **`stock_movements.demand_ref_type text null`** + **`demand_ref_id text null`** — the
  consuming-object envelope. For now `demand_ref_type='work_order'`, `demand_ref_id=<free text>`.
  Intentionally NOT a FK (free-text now). Backfills cleanly into a future `consumption_refs` table.
- **`stock_movements.reason_code text null`** — issue / return / adjustment / scrap reason; keeps
  the enum from sprawling per nuance.
- **`locations.location_kind text null`** — `stockroom` now; later `van | job_site | cabinet | wip |
  quarantine`. One nullable column prevents overloading generic locations when mobile/site arrive.
- **validation (app-layer + a CHECK):** `issue_out` requires demand_ref_type + demand_ref_id and a
  negative quantity; `issue_return` requires the same ref and a positive quantity.

### Deliberately NOT now (condensed OUT of Perplexity's list, with reason)
- `demand_ref_label` — redundant with `demand_ref_id` while refs are free-text. Add with structured refs.
- `movement_role`, `demand_archetype` snapshot, `layer_flags` jsonb — a third/fourth classification
  axis derivable from tenant mode + movement type. Analytics convenience, not correctness. And
  `layer_flags` gives FALSE confidence: traceability / transformation need real enforcement, not a
  flag. Defer.
- `counterparty_location_id` — solves transfers / mobile custody we do not have yet; the Wave-1
  two-row transfer model already works. Add with the multi-location wave (W2-4).

### The one real fork: the header/line split — DEFER
Perplexity "strongly considers" replacing the single-row ledger with `stock_movement_events`
(header) + `stock_movement_lines`. **Recommendation: DEFER.** It delivers no storeroom capability;
it is a Produce / Traceability need (multi-line issues, lot sublines, multi-input WIP). Doing it now
means migrating the entire partitioned Wave-1 ledger plus every ingestion + engine read path
(inventory_levels aggregation, forecast demand series, QBO / CSV import, reorder, scorecards) for a
need several waves out and not yet fixed in shape. The columns added above are header-level concepts
and LIFT to a future event header cleanly, so the split is mechanical-later, not a rewrite-trap. We
split when manufacturing or clinical actually forces multi-line, and not before. **MG nod requested:
this is the only expensive / hard-to-reverse call in the spine.**

**WHEN we introduce it (concrete trigger):** the first time a single inventory event must
ATOMICALLY relieve or produce more than one product line, OR a single line must split across
lot/serial identities. That point is NOT in Wave 2:
- W2-2 storeroom: a kit of 8 parts = 8 `issue_out` rows sharing one `demand_ref_id`. No header.
- W2-3 procurement: POs already use `purchase_orders` + `purchase_order_lines`; receipts post as N
  movements sharing a PO ref (how receive works today). No ledger pressure.
- W2-4 transfers: already the two-row `transfer_out` + `transfer_in` model.

The first HARD requirement is the **Manufacturing / Produce wave** (or a lot-traceability deep
build if that lands first): a BOM backflush consumes N components + produces 1 FG in ONE atomic
event; FEFO lot picking splits one issue across lots. **Default home = the Produce wave. Pull
forward ONLY on an early-warning sign:** a storeroom customer needing a multi-line pick list as one
atomic reversible transaction, or food FEFO lot-picking arriving early.

**HOW it goes in (additive, not a big-bang):** (1) create `stock_movement_events` (header) +
`stock_movement_lines`; (2) backfill 1:1 — each existing row becomes one event + one line, the
`demand_ref_*` / `reason_code` / `source` columns LIFT to the header, `product_id` / `location_id` /
`quantity` drop to the line (this clean lift is WHY we shape the columns this way now); (3) keep a
backward-compat VIEW in the old single-row shape so read paths migrate one at a time. Only cost of
waiting = the backfill grows with row count (bounded, O(rows), we are tiny now).

### Validated warning carried forward
Traceability and Transformation are NOT cosmetic layers. An expired lot must BLOCK an issue; a BOM
consumes many inputs into one output. When those modes arrive they need real transaction primitives
and enforcement, not metadata. That is exactly why we do not fake them with `layer_flags` now.

### Migration authoring
The SQL will be written in-house against the real tables (partition-key and idempotency-index
aware), NOT outsourced. Declined Perplexity's "generate the migration SQL" offer: it lacks our exact
partition / index specifics and migration conventions, and migration authoring is build work, not
research.

### Issue v1 row shape (target)
`issue_out`: quantity `-5`, location `storeroom_a`, `demand_ref_type='work_order'`,
`demand_ref_id='WO-10482'`, `reason_code` optional, `source='manual'|'workflow'`, `source_ref`=
issue-form uuid. `issue_return`: quantity `+2`, same location, same demand ref,
`reason_code='unused_material'`.
```

