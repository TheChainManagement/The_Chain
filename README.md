# The Chain

AI-driven supply chain for small-to-mid B2B distributors. A More Technologies internal product.

## Docs (the contract)

Phase 0 through Phase 4 artifacts. Read them before writing code.

- `PROJECT.md` — vision, audience, type, build philosophy.
- `PRD.md` — features, flows, success criteria.
- `SYSTEM_DESIGN.md` — schema, RLS, adapter contract, workflows, retention.
- `DESIGN_DIRECTION.md` — the design token source of truth.
- `DESIGN.md` — Stitch-compatible semantic system.
- `FEATURES.md` — per-feature Wave 1 build plans.
- `MASTER_PROMPT.md` — per-project execution rules.

## Process

Every change goes through MoreTech's `PROCESS.md` (8 phases, hard checkpoints, Codex Conversation Flow at every push). See `/Users/themoreapp/More Technologies/PROCESS.md`.

## Stack

- Next.js 15 App Router + React 19 + TypeScript 5 (strict)
- Tailwind CSS 4 (tokens via `@theme inline` in `src/styles/globals.css`)
- Supabase (Postgres + RLS + Auth)
- Vercel (Fluid Compute Node + Python; Workflow DevKit for durable orchestration; AI Gateway for Claude)
- Nixtla `statsforecast` (Python function — the forecaster; Claude is explanation only)
- Biome (linter + formatter)
- Vitest (unit + integration; `@workflow/vitest` for workflow tests)
- Playwright (visible-craft gate + integration tests)

## Development

Requires Node 24 LTS, npm 10+, Supabase CLI 2+, Vercel CLI 54+.

```bash
# Install deps
npm install

# Start local Supabase (Postgres + Auth + Storage)
npm run supabase:start

# Start Next.js dev server
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## Phase status

- [x] Phase 0 — Project Init
- [x] Phase 1 — PRD
- [x] Phase 2 — System Design (v2 post-Codex)
- [x] Phase 3 — Design Direction (re-run, build-beautiful invoked, Codex v2 PASS)
- [x] Phase 4 — Build Plan (v2 post-Codex; Foundation block + wired-for suite + adapter contract + edge cases + Phase 6 visible-craft gate)
- [ ] **Phase 5 — Foundation (in progress)**
- [ ] Phase 6 — Features (Wave 1)
- [ ] Phase 7 — Polish + ship
