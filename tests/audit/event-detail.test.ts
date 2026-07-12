import { describe, expect, it } from 'vitest';
import { entityLabel, eventDetail } from '@/lib/audit/transform';

/**
 * W2-2 MG-review fix: a count variance rendered as a bare "Created Stock
 * movement" and was unrecognizable in the audit trail. eventDetail derives the
 * one-line "what" from the after snapshot for movement rows and count-session
 * completion; everything else stays headline-only (null).
 */
describe('eventDetail', () => {
  it('describes a count variance with its signed quantity and reason', () => {
    expect(
      eventDetail('stock_movements', {
        type: 'cycle_count',
        quantity: '-2.00',
        reason_code: 'count_variance',
      }),
    ).toBe('count variance -2 · count_variance');
  });

  it('describes an issue with its consuming object', () => {
    expect(
      eventDetail('stock_movements', {
        type: 'issue_out',
        quantity: '-4.00',
        demand_ref_type: 'work_order',
        demand_ref_id: 'WO-10482',
        reason_code: 'maintenance',
      }),
    ).toBe('issue out -4 · work order WO-10482');
  });

  it('describes an adjustment with its reason and a receipt with a plus sign', () => {
    expect(
      eventDetail('stock_movements', {
        type: 'adjustment',
        quantity: '-2.00',
        reason_code: 'damage',
      }),
    ).toBe('adjustment -2 · damage');
    expect(eventDetail('stock_movements', { type: 'receipt', quantity: '60.00' })).toBe(
      'receipt +60',
    );
  });

  it('marks a completed count session and stays quiet otherwise', () => {
    expect(eventDetail('cycle_count_sessions', { status: 'completed' })).toBe('session completed');
    expect(eventDetail('cycle_count_sessions', { status: 'open' })).toBeNull();
    expect(eventDetail('products', { sku: 'X' })).toBeNull();
    expect(eventDetail('stock_movements', null)).toBeNull();
    expect(eventDetail('stock_movements', {})).toBeNull();
  });

  it('labels the W2-2 tables', () => {
    expect(entityLabel('cycle_count_sessions')).toBe('Count session');
    expect(entityLabel('cycle_count_lines')).toBe('Count line');
    expect(entityLabel('inventory_op_events')).toBe('Operator event');
  });
});
