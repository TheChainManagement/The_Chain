import { describe, expect, it } from 'vitest';
import {
  buildRequisitionChain,
  canCancelRequisition,
  canConvertRequisition,
  canDecideRequisition,
  canSubmitRequisition,
} from '@/lib/procurement/transform';

describe('canSubmitRequisition', () => {
  it('submits from draft, resubmits from rejected, nothing else', () => {
    expect(canSubmitRequisition('draft').ok).toBe(true);
    expect(canSubmitRequisition('rejected').ok).toBe(true);
    for (const s of ['submitted', 'approved', 'converted', 'canceled'] as const) {
      expect(canSubmitRequisition(s).ok).toBe(false);
    }
  });
});

describe('canDecideRequisition — single-step, owner+manager, no self-approval (design §7.1)', () => {
  const base = {
    status: 'submitted' as const,
    role: 'manager',
    actorUserId: 'approver',
    requestedByUserId: 'requester',
  };

  it('lets an owner or manager decide a submission they did not request', () => {
    expect(canDecideRequisition(base).ok).toBe(true);
    expect(canDecideRequisition({ ...base, role: 'owner' }).ok).toBe(true);
  });

  it('blocks planner/viewer/finance from deciding', () => {
    for (const role of ['planner', 'viewer', 'finance', 'warehouse']) {
      expect(canDecideRequisition({ ...base, role }).ok).toBe(false);
    }
  });

  it('NEVER lets the requester approve their own submission', () => {
    const r = canDecideRequisition({ ...base, actorUserId: 'requester' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('your own requisition');
  });

  it('only a submitted document is decidable', () => {
    for (const s of ['draft', 'approved', 'rejected', 'converted', 'canceled'] as const) {
      expect(canDecideRequisition({ ...base, status: s }).ok).toBe(false);
    }
  });
});

describe('canConvertRequisition + canCancelRequisition', () => {
  it('only approved converts; converted names itself', () => {
    expect(canConvertRequisition('approved').ok).toBe(true);
    const done = canConvertRequisition('converted');
    expect(done.ok).toBe(false);
    expect(done.ok === false && done.error).toContain('already become');
    for (const s of ['draft', 'submitted', 'rejected', 'canceled'] as const) {
      expect(canConvertRequisition(s).ok).toBe(false);
    }
  });

  it('cancel covers draft/submitted/rejected only', () => {
    expect(canCancelRequisition('draft').ok).toBe(true);
    expect(canCancelRequisition('submitted').ok).toBe(true);
    expect(canCancelRequisition('rejected').ok).toBe(true);
    expect(canCancelRequisition('approved').ok).toBe(false);
    expect(canCancelRequisition('converted').ok).toBe(false);
  });
});

describe('buildRequisitionChain', () => {
  it('lights the path in order and completes at converted', () => {
    expect(buildRequisitionChain('draft').map((s) => s.state)).toEqual([
      'done',
      'pending',
      'pending',
      'pending',
    ]);
    expect(buildRequisitionChain('approved').map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'pending',
    ]);
    expect(buildRequisitionChain('converted').every((s) => s.state === 'done')).toBe(true);
  });

  it('rejected stops AT the decision node; canceled where the document died', () => {
    expect(buildRequisitionChain('rejected').map((s) => s.state)).toEqual([
      'done',
      'done',
      'stopped',
      'pending',
    ]);
    expect(buildRequisitionChain('canceled').map((s) => s.state)).toEqual([
      'done',
      'stopped',
      'pending',
      'pending',
    ]);
  });
});
