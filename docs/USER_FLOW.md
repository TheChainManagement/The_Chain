# The Chain — User Flow (full app, MVP + future buildouts)

*Authored 2026-06-03. A user-journey map across all 17 Wave-1 feature blocks plus
the wired-for future waves (2-7). Color = build status. This is intentionally big.*

**How to view it visually:**
- Open `docs/user-flow.html` in a browser (renders the diagram with pan/zoom), OR
- View this file on GitHub (it renders the ```mermaid``` block below), OR
- Paste the mermaid block into https://mermaid.live.

## Legend

| Color | Meaning |
|---|---|
| 🟢 Green | Shipped / live today |
| 🟠 Amber | Partial — shell or slice built |
| 🔵 Cobalt | Planned — Wave 1 MVP (next to build) |
| ⬛ Dark | System / background job (no direct user action) |
| ⬜ Gray dashed | Future wave (2-7), wired-for, not in MVP |

```mermaid
flowchart TD
  classDef shipped fill:#1a8c5c,color:#ffffff,stroke:#0f5a3a,stroke-width:1px;
  classDef partial fill:#be7c0e,color:#ffffff,stroke:#7a4f08,stroke-width:1px;
  classDef wave1 fill:#0942b5,color:#ffffff,stroke:#062c78,stroke-width:1px;
  classDef system fill:#11161c,color:#ffffff,stroke:#000000,stroke-width:1px;
  classDef future fill:#e7eaee,color:#11161c,stroke:#9aa6b2,stroke-width:1px,stroke-dasharray:5 3;

  %% ================= DISCOVERY =================
  subgraph MKT["① Discovery — Marketing site (Block 17)"]
    M1["Landing / hero<br/>(chain animation)"]:::partial
    M2["How it works"]:::wave1
    M3["Pricing"]:::wave1
    M4["About / Contact"]:::wave1
    M1 --> M2 --> M3
  end

  %% ================= ACCOUNT =================
  subgraph ACC["② Account (Block 1)"]
    A1["Sign up<br/>14-day trial created"]:::shipped
    A2["Sign in"]:::shipped
    A3["Forgot password<br/>(needs Resend)"]:::wave1
    A4["Signup → workshop<br/>morph transition"]:::shipped
  end
  M1 -->|Start trial| A1
  M3 -->|Start trial| A1
  A1 --> A4 --> ONB
  A2 --> DASH

  %% ================= ONBOARDING =================
  subgraph ONB["③ Onboarding — dual path (Block 2)"]
    O0{"Path picker"}:::wave1
    O1["Connect QuickBooks<br/>OAuth + first sync"]:::wave1
    O2["Upload CSV history"]:::wave1
    O3["Start fresh<br/>guided minimums"]:::wave1
    O4["Preparing your workshop<br/>(first forecast batch)"]:::wave1
    O0 --> O1 --> O4
    O0 --> O2 --> O4
    O0 --> O3 --> O4
  end
  O4 --> DASH

  %% ================= DAILY LANDING =================
  DASH["④ /today — Inventory health dashboard (Block 15)<br/>today's chain · metric strip · Claude rail · alerts<br/>(shell shipped, centerpiece planned)"]:::partial
  DASH --> INV
  DASH --> FORE
  DASH --> REO
  DASH --> ALERTS
  DASH --> SET

  %% ================= DATA INGESTION =================
  subgraph ING["⑤ Data ingestion (Blocks 5, 6)"]
    I1["CSV import — products<br/>upload → map → preview → commit"]:::shipped
    I2["CSV import — suppliers + sales/movements"]:::wave1
    I3["QuickBooks 2-way sync<br/>items · vendors · POs · bills · sales"]:::wave1
    I4["Sync conflicts review<br/>(/flow/sync-conflicts)"]:::wave1
  end
  I1 --> INV
  I2 --> INV
  I2 --> SUP
  I2 --> SALES[("stock_movements<br/>(sales history)")]:::system
  I3 --> INV
  I3 --> SUP
  I3 --> SALES
  I3 --> REO

  %% ================= MASTER DATA =================
  subgraph MD["⑥ Master data (Blocks 3, 4)"]
    INV["Inventory / SKU catalog<br/>list · detail · search/filter · edit/archive · bulk"]:::shipped
    SUP["Suppliers<br/>roster · detail · links · reliability ribbon"]:::shipped
    INVD["SKU detail<br/>position · classification · policy chain"]:::shipped
    INV --> INVD
  end
  INV -->|Import catalog| I1
  INV --> I2

  %% ================= NIGHTLY INTELLIGENCE PIPELINE =================
  subgraph PIPE["⑦ Nightly intelligence batch — system job (Blocks 7,8,9,10)"]
    direction TB
    P1["Classify ABC + XYZ<br/>(value + ADI/CV² from sales)"]:::wave1
    P2["Forecast demand<br/>(Nixtla; method routed by class;<br/>cold-start ladder; beats-naive gate)"]:::wave1
    P3["Derive policy<br/>safety stock z·σ·√L · reorder point ·<br/>order qty · DOS · stockout risk"]:::wave1
    P4["Supplier scorecard rollup<br/>OTIF · empirical lead time + stddev"]:::wave1
    P1 --> P2 --> P3
    P4 -. empirical lead time/σ .-> P3
  end
  SALES --> P1
  SUP --> P4

  %% ================= INTELLIGENCE SURFACES =================
  subgraph INTEL["⑧ Intelligence surfaces"]
    FORE["Forecasts view (Block 8)<br/>history + forecast + confidence bands"]:::wave1
    QUAD["Classification quadrant (Block 7)<br/>ABC×XYZ grid, drag-zoom"]:::wave1
    POL["Optimization / policy (Block 9)<br/>what-if sliders: service level · lead time · supplier"]:::wave1
    WIDG["DOS + Stockout Risk widgets"]:::wave1
  end
  P2 --> FORE
  P1 --> QUAD
  P3 --> POL
  P3 --> WIDG
  WIDG --> INVD
  INVD --> FORE
  INVD --> POL

  %% ================= REORDER LOOP (HERO) =================
  subgraph LOOP["⑨ Reorder loop — the hero (Blocks 11, 13)"]
    ALERTS["Alerts (Block 13)<br/>actionable memos: stockout · overstock · late PO"]:::wave1
    REO["Reorder queue (Block 11)<br/>recommendations grouped by supplier"]:::wave1
    PO["PO detail — the visible chain<br/>recommend → approve → export → receive"]:::wave1
    RCV["Receive (partial/full)<br/>updates on-hand + supplier scorecard"]:::wave1
    REO --> PO --> RCV
  end
  P3 --> ALERTS
  P3 --> REO
  ALERTS -->|cobalt CTA| REO
  PO -->|approve| QBOW["Write PO back to QuickBooks"]:::wave1
  RCV --> SALES
  RCV -. promised vs actual .-> P4

  %% ================= AI INSIGHTS (overlay) =================
  INS["⑩ AI insights — Claude (Block 12)<br/>explains forecasts/policy/reorder · never the forecaster"]:::wave1
  INS -. overlays .-> FORE
  INS -. overlays .-> POL
  INS -. overlays .-> REO
  INS -. overlays .-> DASH

  %% ================= OPS / AUDIT =================
  subgraph OPS["⑪ Flow / ops"]
    AUD["Audit log (Block 14)<br/>every state change · ROI-ready · tier-gated"]:::wave1
    I4
  end
  RCV --> AUD
  PO --> AUD
  INV --> AUD

  %% ================= SETTINGS / BILLING =================
  subgraph SETB["⑫ Settings + billing (Block 16)"]
    SET["Settings"]:::wave1
    BILL["Trial countdown · billing<br/>(Stripe wired, off at launch)"]:::wave1
    SET --> BILL
  end

  %% ================= FUTURE WAVES =================
  subgraph FUT["⑬ Future waves — wired-for, NOT in MVP"]
    F2["Wave 2 — Multi-location<br/>location selector · transfer recs"]:::future
    F3["Wave 3 — Multi-user roles<br/>planner/warehouse/finance/manager/owner views"]:::future
    F4["Wave 4 — Barcode + guided cycle counts"]:::future
    F5["Wave 5 — Rutter adapter<br/>NetSuite · Xero · Shopify · Square · etc."]:::future
    F6["Wave 6 — ROI Impact Dashboard<br/>(reads the audit log)"]:::future
    F7["Wave 7+ — Distribution-ERP natives<br/>Cin7 · Fishbowl · Katana · Zoho · Unleashed"]:::future
  end
  DASH -.-> F2
  DASH -.-> F3
  INV -.-> F4
  ING -.-> F5
  AUD -.-> F6
  ING -.-> F7
```

## Future-buildout notes (what the gray nodes mean, and when)

- **Wave 2 — Multi-location.** Schema already carries on-hand / allocated / in-transit
  *per location*. UI adds a location selector + location-aware dashboards + inter-location
  transfer recommendations. No schema change.
- **Wave 3 — Multi-user + roles.** RLS roles (planner / warehouse / finance / manager /
  owner) are defined from day one; Wave 1 only exposes owner. Wave 3 lights up
  role-specific dashboards + a lightweight "one number everyone reads" S&OP layer.
- **Wave 4 — Barcode + cycle counts.** Count-session + variance schema is in place.
  Browser-based scanning + guided counts, no native app.
- **Wave 5 — Rutter adapter.** Same `SourceAdapter` seam the CSV + QBO adapters already
  implement. Flipping it on adds NetSuite, Acumatica, Sage Intacct, Dynamics 365 BC,
  Xero, Shopify, Square, Clover. Adapter activation, not a rebuild.
- **Wave 6 — ROI Impact Dashboard.** Reads the audit log that's been writing since Day 1.
  Tracks stockout reduction, inventory reduction, expediting cost, payback. (Also the
  home of the optimization-tightening loop in `INVENTORY_OPTIMIZATION_NOTES.md`.)
- **Wave 7+ — Distribution-ERP natives.** Per-customer paid native adapters when a real
  customer needs one. Same adapter contract.

## The MVP spine (read this if nothing else)

The shortest path a paying distributor walks:

**Sign up → connect QBO or upload CSV → catalog + sales land → nightly batch forecasts
+ classifies + sets policy → /today shows what's at risk → alert says "reorder 47 cases
by Wed" → approve the PO → it writes back to QuickBooks → receive it → on-hand updates
and the supplier's reliability score sharpens the next recommendation.**

Everything green is built. Everything cobalt is the MVP work remaining (Tranches B-F).
Everything gray waits for a real customer to pull it forward.
