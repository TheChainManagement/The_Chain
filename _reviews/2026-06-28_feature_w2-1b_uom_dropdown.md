# W2-1b — Unit-of-measure dropdown (evidence)

Date: 2026-06-28. Wave 2 data-model cleanup (W2-1), second sub-feature.
Scope: `docs/WAVE2_SCOPE.md` W2-1 ("unit-of-measure dropdown, label + abbreviation, with an
'other' escape hatch").

## What shipped

- **UoM reference** `src/lib/uom/units.ts` (pure): a curated set of 20 common units, each with a
  short code (stored value) + friendly label, grouped by category (Count / Weight / Volume /
  Length). Helpers: `uomLabel` (code → label, custom/legacy passthrough), `isKnownUom`,
  `uomOptionGroups` (for the picker's optgroups).
- **UomPicker** `src/components/UomPicker/UomPicker.tsx` (client): a categorized `<select>` plus an
  **"Other…" escape hatch** that reveals a custom text field. Submits a single `unit_of_measure`
  value via a hidden input, so it drops into any FormData server-action form; takes the host's input
  `className` to match each form. Round-trips a default value (known code → preselected; custom /
  legacy value → "Other" with the field prefilled).
- **Wired into all three product forms**: AddSku (create), SkuActions (edit), and the onboarding
  FirstProductForm — each free-text UoM box is now the picker. The SKU detail shows the friendly
  label via `uomLabel`.

## Migration-free + non-destructive

`products.unit_of_measure` stays a free-form text column. The picker constrains *new* entry but the
column accepts custom ("Other") and pre-existing values unchanged — no migration, no backfill, and
the create/update actions stay free-form (no enum). Legacy values display as-is via `uomLabel`.

## Verification

- **Pure reference test** (`tests/uom/units.test.ts`): unique codes, `uomLabel` known/custom/blank,
  `isKnownUom`, category grouping covers every option once.
- **Memorable RTL test** (`tests/uom/uom-picker.test.tsx`): renders the real picker — selecting a
  curated code submits it; "Other" reveals the custom field and submits the typed value; a known
  default preselects; a custom/legacy default opens "Other" prefilled. The hidden-input contract is
  asserted so the form value can't silently regress.
- Gates: `tsc`, `biome`, `check:craft`, `next build` — all green. UoM tests 8/8.
- The live authed browser screenshot is blocked by the same local GoTrue auth breakage as W2-0/W2-1a
  (can't sign in to reach the product form). The RTL test renders the real component and is the
  behavioral proof; the picker compiles into all three forms in the production build.

## Next

MG checkpoint → `moretech-codex-review` → push (no hosted migration — schema unchanged). Then W2-1c
(supplier address + contact-person).
