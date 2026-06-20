# The Chain — Pricing Research & Draft Decision

Status: **DRAFT — awaiting MG confirmation of the three numbers.** Feeds the
`/pricing` page (Block 17b/17c). Not needed for 17a.
Source: Perplexity competitor sweep, 2026-06-20.

## Market anchors (public prices, USD/mo)

| Tool | Entry | Mid | Notes |
|---|---|---|---|
| Zoho Inventory | $29 → $79 → $129 → $249 | — | inventory-first, not forecasting; QBO sync |
| SOS Inventory | ~$70 | ~$140 → ~$195 | QBO-core, manufacturing focus |
| inFlow | ~$110 | ~$279 → ~$549 | $499 one-time setup on some listings |
| Unleashed | $99 (Core) | $399 (Pro) | broader inventory ops |
| Cogsy | $199 | — | demand planning, e-comm oriented |
| Settle | free / $199 / $499 | — | forecasting only from $199+; all-SKU at $499 |
| Katana | ~$179–$299 | $349 | MRP; conflicting public tiers |
| Cin7 | $349 (Standard) | $599 (Pro) | the heavy QBO comparable |
| Fishbowl | ~$229–$349 | $429 → $729 | seat + feature gating |
| Finale | $199 → $499 → $699 | — | QBO is an extra-cost add-on |
| StockTrim / Lokad / Netstock / Inventory Planner | $150+ / quote | — | forecasting specialists, often quote-based |

**The gap:** a QuickBooks-native **forecasting-first** layer between cheap
inventory sync (Zoho/SOS, <$200, no real forecasting) and full inventory ERP
(Cin7/Fishbowl/Unleashed, $349+, heavy). Small distributors on QBO + spreadsheets
need defensible forecasts + reorder automation + supplier scorecards, not a WMS.

## Draft decision (recommended)

Price by **value band** (SKU count / locations / users), NOT per seat — matches
the PRD's multi-location growth path and the research's advice. Map onto the
existing `retention_tier` enum so billing and audit-window stay one axis:

| Plan | `retention_tier` | Price/mo | Audit window | Who |
|---|---|---|---|---|
| Free trial (14d) | `free` | $0 | trial period | everyone, all features |
| **Starter** | `starter` | **$129** | 1 year | single location, 1–2 users, QBO + forecasting + reorder + scorecards |
| **Growth** | `standard` | **$299** | 5 years | multi-location, more SKUs/users — the main conversion target |
| **Pro** | `pro` | **$599** | 10 years | multi-entity, deeper analytics, priority |
| Enterprise | `enterprise` | Contact | unlimited | custom |

Rationale: $129 entry sits above "try it vs a spreadsheet" without cheapening
the forecasting value; $299 Growth lands at adjacent-planning-tool prices while
undercutting Cin7/Fishbowl; $599 Pro stays below ERP-class platforms. All three
inside the research's recommended bands (entry $99–149 / growth $249–349 / pro
$499–749).

**Open for MG:** confirm or adjust the three numbers ($129 / $299 / $599) and the
plan names (Starter / Growth / Pro). Once locked, `/pricing` renders them via
`<StatNumber>` against a hairline tier table (no card boxes) with the retention
compare-row.
