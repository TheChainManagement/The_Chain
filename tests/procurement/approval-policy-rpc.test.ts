import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'b5000000-0000-0000-0000-000000000001';
const OWNER = 'b5000000-0000-0000-0000-000000000011';
const MANAGER = 'b5000000-0000-0000-0000-000000000012';
const PLANNER = 'b5000000-0000-0000-0000-000000000013';
const NEW_MEMBER = 'b5000000-0000-0000-0000-000000000014';

let client: Client;
let locationId: string;
let productId: string;
let supplierId: string;

async function one<T2 extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const { rows } = await client.query<T2>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`expected a row from: ${sql}`);
  return row;
}

async function addMember(userId: string, role: string): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, email)
     values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [userId, `${role}-${userId.slice(-2)}@example.test`],
  );
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role)
     values ($1, $2, $3::member_role)`,
    [T, userId, role],
  );
}

async function createRequisition(
  total: number,
  requester = PLANNER,
  version?: { sourceRfqId: string; awardVersion: number; supersedes: string | null },
): Promise<string> {
  await asSuperuser(client);
  const req = await one<{ id: string }>(
    `insert into requisitions
       (tenant_id, location_id, requested_by_user_id, total, source_rfq_id,
        award_version, supersedes_requisition_id, is_current_version)
     values ($1, $2, $3, $4, $5, $6, $7, true)
     returning id`,
    [
      T,
      locationId,
      requester,
      total,
      version?.sourceRfqId ?? null,
      version?.awardVersion ?? 1,
      version?.supersedes ?? null,
    ],
  );
  await client.query(
    `insert into requisition_lines
       (tenant_id, requisition_id, line_no, product_id, supplier_id, qty, unit_cost)
     values ($1, $2, 1, $3, $4, 1, $5)`,
    [T, req.id, productId, supplierId, total],
  );
  return req.id;
}

async function configure(
  member: string,
  mode: string,
  requesterLimit: number | null,
  approverLimit: number | null,
): Promise<void> {
  await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
  await client.query('select * from set_member_requisition_authority($1, $2, $3, $4, $5)', [
    T,
    member,
    mode,
    requesterLimit,
    approverLimit,
  ]);
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, OWNER, 'w3-approval');
  await addMember(MANAGER, 'manager');
  await addMember(PLANNER, 'planner');
  const ids = await one<{ location_id: string; product_id: string; supplier_id: string }>(
    `select
       (select id from locations where tenant_id = $1 limit 1) as location_id,
       (select id from products where tenant_id = $1 limit 1) as product_id,
       (select id from suppliers where tenant_id = $1 limit 1) as supplier_id`,
    [T],
  );
  locationId = ids.location_id;
  productId = ids.product_id;
  supplierId = ids.supplier_id;
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('member requisition authority administration', () => {
  it('backfills existing people and defaults a newly activated member to approval required', async () => {
    await asSuperuser(client);
    const existing = await client.query<{ requester_mode: string }>(
      `select requester_mode from tenant_member_requisition_authority
       where tenant_id = $1 order by user_id`,
      [T],
    );
    expect(existing.rows).toHaveLength(3);
    expect(existing.rows.every((row) => row.requester_mode === 'always_require_approval')).toBe(
      true,
    );

    await addMember(NEW_MEMBER, 'viewer');
    const created = await one<{ requester_mode: string; requester_limit: string | null }>(
      `select requester_mode, requester_limit from tenant_member_requisition_authority
       where tenant_id = $1 and user_id = $2`,
      [T, NEW_MEMBER],
    );
    expect(created).toEqual({
      requester_mode: 'always_require_approval',
      requester_limit: null,
    });
  });

  it('lets only an owner configure explicit modes and independent ceilings', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query('savepoint manager_authority');
    await expect(
      client.query('select * from set_member_requisition_authority($1, $2, $3, $4, $5)', [
        T,
        PLANNER,
        'auto_approve_to_limit',
        1500,
        null,
      ]),
    ).rejects.toThrow('authority_forbidden');
    await client.query('rollback to savepoint manager_authority');

    await configure(PLANNER, 'auto_approve_to_limit', 1500, null);
    await asSuperuser(client);
    const configured = await one<{
      requester_mode: string;
      requester_limit: string;
      approver_limit: string | null;
    }>(
      `select requester_mode, requester_limit, approver_limit
       from tenant_member_requisition_authority where tenant_id = $1 and user_id = $2`,
      [T, PLANNER],
    );
    expect(configured).toEqual({
      requester_mode: 'auto_approve_to_limit',
      requester_limit: '1500.00',
      approver_limit: null,
    });

    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('savepoint direct_policy_write');
    await expect(
      client.query(
        `update tenant_member_requisition_authority set requester_mode = 'auto_approve_unlimited'
         where tenant_id = $1 and user_id = $2`,
        [T, PLANNER],
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await client.query('rollback to savepoint direct_policy_write');
  });
});

describe('submit_requisition policy evaluation', () => {
  it('forged-requester insert is rejected', async () => {
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('savepoint forged_requester');
    await expect(
      client.query(
        `insert into requisitions
           (tenant_id, location_id, requested_by_user_id, total)
         values ($1, $2, $3, 99900)`,
        [T, locationId, OWNER],
      ),
    ).rejects.toThrow('requester_must_be_caller');
    await client.query('rollback to savepoint forged_requester');
  });

  it('author-as-another-then-self-approve is rejected', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query('savepoint forged_author');
    await expect(
      client.query(
        `insert into requisitions
           (tenant_id, location_id, requested_by_user_id, total)
         values ($1, $2, $3, 500)`,
        [T, locationId, PLANNER],
      ),
    ).rejects.toThrow('requester_must_be_caller');
    await client.query('rollback to savepoint forged_author');
  });

  it('honest self-requester path still works end to end', async () => {
    await configure(PLANNER, 'always_require_approval', null, null);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    const created = await one<{ out_requisition_id: string }>(
      'select * from create_direct_requisition($1, $2, $3, $4, 2, 25, $5)',
      [T, locationId, productId, supplierId, PLANNER],
    );
    expect(await one('select * from submit_requisition($1, $2)', [T, created.out_requisition_id]))
      .toMatchObject({ out_status: 'submitted' });

    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    expect(
      await one(`select * from decide_requisition($1, $2, 'approved', null)`, [
        T,
        created.out_requisition_id,
      ]),
    ).toMatchObject({ out_status: 'approved' });
  });

  it('queues the shipped default and rejects a direct lifecycle bypass', async () => {
    await configure(PLANNER, 'always_require_approval', null, null);
    const req = await createRequisition(75);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('savepoint direct_submit');
    await expect(
      client.query(`update requisitions set status = 'submitted' where id = $1`, [req]),
    ).rejects.toThrow('submission_rpc_required');
    await client.query('rollback to savepoint direct_submit');

    const result = await one<{
      out_status: string;
      out_reason: string;
      out_auto_approved: boolean;
    }>('select * from submit_requisition($1, $2)', [T, req]);
    expect(result).toEqual({
      out_status: 'submitted',
      out_reason: 'approval_required_by_policy',
      out_auto_approved: false,
    });
    await client.query('savepoint submitted_document_edit');
    await expect(
      client.query('update requisitions set total = 1 where id = $1', [req]),
    ).rejects.toThrow('submitted_total_immutable');
    await client.query('rollback to savepoint submitted_document_edit');
    await client.query('savepoint submitted_line_edit');
    await expect(
      client.query(
        'update requisition_lines set unit_cost = 1 where requisition_id = $1 and line_no = 1',
        [req],
      ),
    ).rejects.toThrow('requisition_not_editable');
    await client.query('rollback to savepoint submitted_line_edit');
  });

  it('auto-approves at the exact requester limit and records system audit evidence', async () => {
    await configure(PLANNER, 'auto_approve_to_limit', 1500, null);
    const req = await createRequisition(1500);
    await asSuperuser(client);
    const before = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(i) order by i.product_id, i.location_id), '[]')
          from inventory_levels i where i.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    const result = await one<{
      out_status: string;
      out_reason: string;
      out_auto_approved: boolean;
    }>('select * from submit_requisition($1, $2)', [T, req]);
    expect(result).toEqual({
      out_status: 'approved',
      out_reason: 'within_requester_limit',
      out_auto_approved: true,
    });

    await asSuperuser(client);
    const document = await one<{
      status: string;
      approved_by_user_id: string | null;
      decided_at: Date | null;
      approval_reason: string;
      snapshot: Record<string, unknown>;
    }>(
      `select status, approved_by_user_id, decided_at, approval_reason,
              approval_policy_snapshot as snapshot
       from requisitions where id = $1`,
      [req],
    );
    expect(document.status).toBe('approved');
    expect(document.approved_by_user_id).toBeNull();
    expect(document.decided_at).not.toBeNull();
    expect(document.approval_reason).toBe('within_requester_limit');
    expect(document.snapshot).toMatchObject({
      decision_actor: 'system',
      requester_user_id: PLANNER,
      requester_mode: 'auto_approve_to_limit',
      requester_limit: 1500,
      evaluated_total: 1500,
    });
    const audit = await one<{ after: Record<string, unknown> }>(
      `select after from audit_log
       where tenant_id = $1 and entity_type = 'requisitions' and entity_id = $2
         and after->>'approval_reason' = 'within_requester_limit'
       order by occurred_at desc, id desc limit 1`,
      [T, req],
    );
    expect(audit.after).toMatchObject({
      status: 'approved',
      approved_by_user_id: null,
      approval_reason: 'within_requester_limit',
    });
    const after = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(i) order by i.product_id, i.location_id), '[]')
          from inventory_levels i where i.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );
    expect(after).toEqual(before);
  });

  it('routes above-limit requests and auto-approves unlimited authority', async () => {
    await configure(PLANNER, 'auto_approve_to_limit', 99, null);
    const over = await createRequisition(100);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    expect(await one('select * from submit_requisition($1, $2)', [T, over])).toMatchObject({
      out_status: 'submitted',
      out_reason: 'requester_limit_exceeded',
      out_auto_approved: false,
    });

    await configure(PLANNER, 'auto_approve_unlimited', null, null);
    const unlimited = await createRequisition(500_000);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    expect(await one('select * from submit_requisition($1, $2)', [T, unlimited])).toMatchObject({
      out_status: 'approved',
      out_reason: 'unlimited_requester_authority',
      out_auto_approved: true,
    });
  });

  it('evaluates the current policy again for a replacement award version', async () => {
    await configure(PLANNER, 'always_require_approval', null, null);
    await asSuperuser(client);
    const rfq = await one<{ id: string }>(
      `insert into rfqs (tenant_id, location_id, status, created_by_user_id)
       values ($1, $2, 'quoted', $3) returning id`,
      [T, locationId, PLANNER],
    );
    const v1 = await createRequisition(200, PLANNER, {
      sourceRfqId: rfq.id,
      awardVersion: 1,
      supersedes: null,
    });
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    expect(await one('select * from submit_requisition($1, $2)', [T, v1])).toMatchObject({
      out_status: 'submitted',
    });

    await asSuperuser(client);
    await client.query('update requisitions set is_current_version = false where id = $1', [v1]);
    const v2 = await createRequisition(200, PLANNER, {
      sourceRfqId: rfq.id,
      awardVersion: 2,
      supersedes: v1,
    });
    await configure(PLANNER, 'auto_approve_to_limit', 200, null);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    expect(await one('select * from submit_requisition($1, $2)', [T, v2])).toMatchObject({
      out_status: 'approved',
      out_reason: 'within_requester_limit',
    });
  });
});

describe('purchase order approval evidence', () => {
  it('rejects a direct PO and accepts one converted from an approved current requisition', async () => {
    await asSuperuser(client);
    const direct = await one<{ id: string }>(
      `insert into purchase_orders
         (tenant_id, supplier_id, location_id, status, recommended_by, total)
       values ($1, $2, $3, 'draft', 'user', 25)
       returning id`,
      [T, supplierId, locationId],
    );
    await client.query(
      `insert into purchase_order_lines
         (tenant_id, po_id, line_no, product_id, ordered_qty, unit_cost)
       values ($1, $2, 1, $3, 1, 25)`,
      [T, direct.id, productId],
    );

    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('savepoint direct_po_bypass');
    await expect(
      client.query(`select * from apply_po_approval($1, $2, 'sent')`, [T, direct.id]),
    ).rejects.toThrow('approved_requisition_required');
    await client.query('rollback to savepoint direct_po_bypass');

    await configure(PLANNER, 'always_require_approval', null, null);
    const requisitionId = await createRequisition(25);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('select * from submit_requisition($1, $2)', [T, requisitionId]);
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query(`select * from decide_requisition($1, $2, 'approved', null)`, [
      T,
      requisitionId,
    ]);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    const converted = await one<{ out_po_id: string }>(
      'select * from convert_requisition_to_po($1, $2)',
      [T, requisitionId],
    );
    expect(
      await one(`select * from apply_po_approval($1, $2, 'sent')`, [T, converted.out_po_id]),
    ).toMatchObject({ out_status: 'sent', out_applied: true });
  });
});

describe('human approver authority', () => {
  it('keeps self-approval blocked and enforces a configured ceiling inclusively', async () => {
    await configure(PLANNER, 'always_require_approval', null, null);
    await configure(MANAGER, 'always_require_approval', null, 100);
    const req = await createRequisition(101);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('select * from submit_requisition($1, $2)', [T, req]);

    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query('savepoint over_ceiling');
    await expect(
      client.query(`select * from decide_requisition($1, $2, 'approved', null)`, [T, req]),
    ).rejects.toThrow('approval_over_authority');
    await client.query('rollback to savepoint over_ceiling');

    await configure(MANAGER, 'always_require_approval', null, 101);
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query(`select * from decide_requisition($1, $2, 'approved', null)`, [T, req]);

    await configure(OWNER, 'always_require_approval', null, null);
    const own = await createRequisition(10, OWNER);
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('select * from submit_requisition($1, $2)', [T, own]);
    await client.query('savepoint self_approval');
    await expect(
      client.query(`select * from decide_requisition($1, $2, 'approved', null)`, [T, own]),
    ).rejects.toThrow('self_approval_forbidden');
    await client.query('rollback to savepoint self_approval');
  });

  it('whitelists status transitions and clears decision evidence on return to draft', async () => {
    await configure(PLANNER, 'always_require_approval', null, null);
    const draft = await createRequisition(40);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query('savepoint patch_converted');
    await expect(
      client.query(`update requisitions set status = 'converted' where id = $1`, [draft]),
    ).rejects.toThrow('bad_requisition_transition');
    await client.query('rollback to savepoint patch_converted');

    await client.query('select * from submit_requisition($1, $2)', [T, draft]);
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query(`select * from decide_requisition($1, $2, 'rejected', 'revise')`, [
      T,
      draft,
    ]);
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    await client.query(`update requisitions set status = 'draft' where id = $1`, [draft]);
    const reopened = await one<{
      status: string;
      approved_by_user_id: string | null;
      decided_at: Date | null;
      rejection_note: string | null;
      approval_reason: string | null;
      approval_policy_snapshot: Record<string, unknown> | null;
    }>(
      `select status, approved_by_user_id, decided_at, rejection_note,
              approval_reason, approval_policy_snapshot
       from requisitions where id = $1`,
      [draft],
    );
    expect(reopened).toEqual({
      status: 'draft',
      approved_by_user_id: null,
      decided_at: null,
      rejection_note: null,
      approval_reason: null,
      approval_policy_snapshot: null,
    });
  });

  it('keeps submit and decide as security invoker functions', async () => {
    await asSuperuser(client);
    const rows = await client.query<{ proname: string; security_definer: boolean }>(
      `select p.proname, p.prosecdef security_definer
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('submit_requisition', 'decide_requisition')
       order by p.proname`,
    );
    expect(rows.rows).toEqual([
      { proname: 'decide_requisition', security_definer: false },
      { proname: 'submit_requisition', security_definer: false },
    ]);
  });
});
