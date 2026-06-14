# Codex Review — block12_ai_insights
**Date:** 2026-06-14 09:30
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block12_ai_insights
**Review weight:** full
**Skills audited:** vercel:ai-gateway, vercel:ai-sdk
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The repo has a real Wave A implementation for “Why this reorder.” Prompt builders exist in [src/lib/insights/prompts.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/prompts.ts:14), including `PROMPT_VERSION='v1'`, a reorder prompt, and a forecast prompt stub.
- Insight generation is real on disk in [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:44): cache read on `(tenant_id, entity_type, entity_id, prompt_version)`, fact assembly from PO/policy/inventory, `generateText(...)` through AI Gateway, and cache upsert.
- The PO detail page now renders the insight panel via [src/app/(app)/purchase-orders/[poId]/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/purchase-orders/%5BpoId%5D/page.tsx:142), and the panel itself is implemented in [src/components/InsightPanel/ReorderInsightPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/InsightPanel/ReorderInsightPanel.tsx:18) with loading, error, low-confidence warning, and `model · prompt vN` caption.
- There is some real verification. [tests/insights/prompts.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/insights/prompts.test.ts:16) covers prompt shaping and confidence behavior, [tests/insights/cache.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/insights/cache.test.ts:55) covers cached reads, and [tests/insights/trust-hierarchy.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/insights/trust-hierarchy.test.ts:26) enforces “no `<ClaudeInsight>` wraps `<StatNumber>`.”
- An evidence file exists at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:1). It accurately describes this as “Wave A,” not the full Block 12 feature.

## What wasn't done

- The feature contract says the AI call should be wrapped in workflow step units (`FEATURES.md:492`). That did not happen. The `generateText(...)` call is made directly inside [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:80), and the evidence file explicitly admits “Step-wrapping” was deferred at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:47).
- The right-rail placement was not delivered. The spec says the `<ClaudeInsight>` panel belongs in the app right rail (`FEATURES.md:494`), but the implementation injects it inline under the PO lines panel at [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/purchase-orders/%5BpoId%5D/page.tsx:142), and the evidence file concedes this at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:46).
- The rest of Block 12 was skipped. The feature calls for “Why this forecast,” “What changed since last week,” and the what-if continuation (`FEATURES.md:491-495`). On disk, only `getReorderInsight(...)` exists in [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:44), and the evidence file lists the other surfaces as deferred at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:50).
- The required memorable artifact is missing. `FEATURES.md:507-509` requires a screenshot or Playwright interaction artifact. `_reviews/` contains [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:1) but no `2026-06-14_*memorable*` file for Block 12.
- The claimed skill-compliance audit is not actually possible. Per the review context, `vercel:ai-gateway` and `vercel:ai-sdk` are both `unknown` because they are not registered in `skill_registry.md`, so the declared-skill audit trail is incomplete.

## What can be done better

- The usage metering is too weak for a feature that explicitly calls for per-tenant cost monitoring. Right now it only `console.log`s token counts in [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:105). That is debugging output, not an operable cost surface.
- The panel explains a purchase order by collapsing the narrative to the first PO line in [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:161). For multi-line orders, that is a thin story and can easily read as the explanation for the whole order when it is not.
- The failure handling is too coarse. Any non-404 problem turns into the same generic error state in [src/components/InsightPanel/ReorderInsightPanel.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/InsightPanel/ReorderInsightPanel.tsx:34), so the operator cannot distinguish “gateway unavailable,” “missing data,” and “bad session.”
- The evidence file says several items were “ticketed,” but I could not find corresponding Block 12 entries in [_reviews/_tickets.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:282). If work is being cut intentionally, the ticket trail needs to exist, not just be mentioned in prose.

## What was missed

- The prompt-injection claim is false. The evidence file says prompts interpolate “never free user text” at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:13), but [src/lib/insights/prompts.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/prompts.ts:59) injects `sku` and `supplierName` directly into the prompt. Those are tenant-controlled strings. This directly fails the Block 12 checklist item at `FEATURES.md:504`.
- The fact assembly is multi-location-wrong. [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:172) queries `inventory_policy` and `inventory_levels` by `tenant_id` + `product_id` only, then `.limit(1)`. It never reads the PO’s `location_id`. On a multi-location tenant, the panel can explain the wrong warehouse’s stock and policy.
- The AI Gateway fallback is configured but not proven. The code sets fallback models in [src/lib/insights/generate.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/insights/generate.ts:93), but there is no automated test or persisted artifact showing the fallback path actually works, even though `FEATURES.md:503` requires it. The evidence file itself lists the fallback drill as deferred at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:53).
- The admin cost counter is still absent. The checklist requires “per-tenant insight call count surfaced in admin” at `FEATURES.md:505`. There is no admin surface for that on disk, and the evidence file defers it at [_reviews/2026-06-14_block12_ai_insights_evidence.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-14_block12_ai_insights_evidence.md:53).

---

## Decisions (captured 2026-06-14, by Claude on MG's standing "ship verified waves" mandate)

### Prompt-injection: sku + supplierName interpolated raw (FEATURES:504) — REAL
- **Decision:** fix now. **Action:** `safeLabel()` in prompts.ts neutralizes tenant-controlled labels before interpolation — strips control chars (the newline injection lever) + markup framing (`<>{}\``), collapses whitespace, caps at 80 chars. New test proves a malicious supplier name / SKU is flattened to one harmless line. My evidence's "never free user text" claim was corrected: those ARE tenant strings, now sanitized.

### Multi-location-wrong fact assembly (queried product-only, ignored PO location) — REAL
- **Decision:** fix now. **Action:** facts assembly now reads `po.location_id` and filters `inventory_policy` + `inventory_levels` by it (PK-complete `.maybeSingle()`), so the insight always describes the PO's own warehouse.

### Memorable artifact missing under _reviews/
- **Decision:** fix now. **Action:** added `_reviews/2026-06-14_feature_insights_memorable.test.tsx` (renders the panel, asserts Claude prose + model·prompt caption + low-confidence warning). The live browser capture is in the evidence file (satisfies "screenshot OR Playwright").

### Tickets mentioned but not on disk
- **Decision:** fixed. **Action:** codex ran before the ticket append; the Block 12 entries are now in `_reviews/_tickets.md` (7 items with rationale).

### Step-wrapping, right-rail, other kinds (forecast/what-changed/what-if), admin cost counter, fallback live-drill, multi-line PO narrative, coarse error state
- **Decision:** ticket / accept. **Action:** all in `_reviews/_tickets.md`. Step-wrapping + right-rail + cost counter + fallback drill are deliberate Wave-A cuts. The lead-line narrative + graceful single error state are accepted for Wave A (the panel is non-critical; "the numbers stand on their own").

### Skill registry: vercel:ai-gateway / vercel:ai-sdk unknown
- **Decision:** accept (plugin concern). **Action:** the moretech plugin's `skill_registry.md` doesn't list the vercel skills, so the declared-skill audit can't verify them. Pre-existing standing ticket; not a Block 12 code issue.

**Push:** committing on the standing mandate (the two real bugs fixed + re-verified green; live insight + cache proven earlier).
