# Evidence — (app)/error.tsx segment boundary (2026-06-03)

Closes the Block 3+4 Codex round-1 finding "feature pages throw raw Errors with
no route-level error.tsx surface."

## How verified (live, dev server on :3100)
1. Signed up a throwaway tenant (`boundary-test@thechain.test`) → landed authenticated on `/today` (signup→workshop morph completed, no console errors).
2. Temporarily added `if (sp.q === '__boom__') throw new Error(...)` to `inventory/page.tsx`.
3. Navigated to `/inventory?q=__boom__`. The thrown error was caught by `(app)/error.tsx`.
4. Reverted the temporary throw; typecheck/lint(81)/craft re-confirmed clean.

## Result (accessibility snapshot of the caught state)
- Left nav + RightRail context stayed mounted (layout persists; only the surface
  content was replaced) — confirms the boundary sits at the segment, not the root.
- Surface rendered:
  - `sectionheader`: eyebrow **"BENCH · INTERRUPTED"**, heading **"This surface stalled"**
  - error `Panel`: prefix **"ERROR"**, title **"Couldn't load this surface"**, `alert` role with the recovery copy
  - cobalt **"Try again"** `ActionButton` (calls `reset()`)
- Built entirely from existing tokenized components (PageHeader, Panel error state,
  ActionButton) — no new raw CSS; craft guard PASS.

## Note
The inline screenshot taken during verification was not persisted to disk (the
preview tool returned it inline; the file write to `2026-06-03_error_boundary.png`
did not land). The accessibility snapshot above is the on-disk evidence of record.
The png reference in commit 87f1fe1 should be read as "this evidence file."
