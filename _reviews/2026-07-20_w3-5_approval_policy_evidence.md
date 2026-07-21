# W3-5 requisition approval-policy evidence — 2026-07-20

## What was done

- Added one explicit per-member authority record with three requester modes:
  `always_require_approval`, `auto_approve_to_limit`, and `auto_approve_unlimited`. Existing members
  were backfilled and every new membership receives the shipped approval-required default.
- Added an independent nullable human approver ceiling. Null means unlimited; zero remains a real
  ceiling and is never overloaded as a policy mode.
- Added the owner-only `set_member_requisition_authority()` RPC and closed direct policy writes.
  Managers can read the resulting company policy but cannot grant or raise authority.
- Replaced direct requisition submission with the row-locked `submit_requisition()` RPC. It locks
  the requisition, costed line snapshots, requester membership, and policy before recomputing the
  authoritative total and evaluating the current policy in one transaction.
- A qualifying request moves directly to `approved`, leaves `approved_by_user_id` null, stamps
  `decided_at`, and records the system decision, requester/member policy snapshot, evaluated total,
  limit, award version, and exact reason in the immutable requisition audit row. Non-qualifying
  requests remain in the normal submitted queue.
- Hardened `decide_requisition()` with current-database owner/manager membership, W3-3 location
  access, and an inclusive per-member ceiling. The existing requester self-approval guard remains.
- Added owner controls to each Team card and a requisition result plate that explains the recorded
  audit reason. “Submit requisition” no longer promises that every request enters a human queue.

## Security and transaction contract

- Direct submitted/approved/rejected lifecycle transitions now require their guarded RPC context;
  a plain PostgREST update cannot bypass requester policy, approver ceilings, or self-approval.
- Submitted totals and lines are frozen. Submission locks lines before totaling them, preventing a
  line-edit race from changing the amount after policy evaluation or before a human ceiling check.
- Owner policy mutation and submission both use database membership rather than trusting the role
  label alone. Human decisions additionally re-check location access at the database boundary.
- Automatic approval is not routed through the human decision RPC. It is explicitly a system
  decision delegated by the owner, and its audit snapshot says `decision_actor = system` while the
  human approver column remains null.
- Policy, submit, decide, and audit work are document-only. No path writes `inventory_levels` or
  `stock_movements`; the database probe compares both before and after automatic approval.

## Database probes

- Backfill and new-member default: every row begins at `always_require_approval` with no requester
  limit; the membership trigger creates the same default for a new member.
- Owner boundary: owner configuration succeeds; manager configuration and direct table mutation do
  not. The mode/amount contract rejects ambiguous or negative values.
- Requester evaluation: default queues; total equal to the configured limit approves; one cent over
  routes; unlimited approves; all paths return their exact reason.
- Audit evidence: automatic approval has no human approver and the immutable requisition audit
  snapshot contains the policy, member, limit, evaluated total, award version, and reason.
- Re-versioning: V1 submitted under approval-required remains queued; replacement V2 is evaluated
  again after the owner changes the current member policy and auto-approves at the new limit.
- Human routing: an approver below the total receives `approval_over_authority`; equality succeeds;
  the requester still receives `self_approval_forbidden`.
- Lifecycle integrity: direct submission, submitted-header total edits, and submitted-line edits are
  rejected. Automatic approval leaves inventory levels and the movement ledger byte-identical.

## Visible verification

- Authenticated local owner `mg-store@local.test` opened `/settings/team`, changed requester policy
  to automatic approval through $1,500, set a $50,000 human approval ceiling, and received the
  persisted success state.
- The Team authority card was inspected at desktop width and 390px. The first pass exposed a
  four-control wrap; the final desktop grid holds mode, requester limit, approver ceiling, and save
  action on one line, then collapses to a readable single column on mobile.
- A real $480 requisition was drafted and submitted in the browser. It moved straight to approved,
  offered PO conversion, and displayed “Approved automatically” with the recorded $1,500 authority
  explanation and audit-trail notice. Browser warnings/errors: zero.
- The surface reuses the Chain's flat clipped panels, mono authority labels, hairline divisions,
  semantic flow color, square controls, and existing responsive shell; no new visual language or
  dependency was introduced. The pre-existing vertically heavy mobile navigation remains deferred.

## What was not done

- No multi-step approval chain, role-wide default hierarchy, outbound approval notification, or
  custom approval groups were added. W3-5 routes over the existing owner/manager queue.
- No production migration or deploy was performed. This remains a local branch migration pending
  the MG/Claude checkpoint and final six-role production gate.

## Final gate

- `npm run typecheck`: green.
- `npm run lint`: 366 source files green.
- `npm run check:craft`: token discipline and trust hierarchy green.
- `npm test`: 140 files / 980 tests green.
- `npm run build`: optimized Next.js production build green; 59 static pages generated.
- Authenticated desktop + 390px Team walkthrough and real automatic-approval walkthrough: green,
  console clean.
- Final `supabase db reset`: every local migration replayed successfully through W3-5.

## Production gate after MG/Claude approval

Apply the Wave 3 batch in this exact order: `20260717120000_w3_0_access_spine.sql` →
`20260717133000_w3_1_provisional_accounts.sql` → `20260718120000_w3_2_tenant_switch.sql` →
`20260718123000_w3_2_review_hardening.sql` → `20260718130000_w3_3_location_assignments.sql` →
`20260718140000_w3_4_primary_location_atomicity.sql` →
`20260720120000_w3_5_requisition_approval_policy.sql`, then run the six-role/stale-session probes,
schema diff, and advisor checks. This ordered batch includes the W3-4 primary-location race fix.
