-- ============================================================
-- The Chain — W3-5: owner-configured requisition approval policy
-- Source: docs/WAVE3_W3-0_ROLE_SPINE_DESIGN.md §10.6 / §11.5
-- ============================================================
-- Documents only. This migration never writes inventory_levels or
-- stock_movements. Submission is the single transactional policy evaluation;
-- human decisions remain separate and retain the no-self-approval boundary.

create type public.requisition_requester_mode as enum (
  'always_require_approval',
  'auto_approve_to_limit',
  'auto_approve_unlimited'
);

create table public.tenant_member_requisition_authority (
  tenant_id uuid not null,
  user_id uuid not null,
  requester_mode public.requisition_requester_mode not null
    default 'always_require_approval',
  requester_limit numeric(14,2),
  approver_limit numeric(14,2),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id) on delete cascade,
  constraint requester_authority_contract check (
    (requester_mode = 'auto_approve_to_limit' and requester_limit is not null and requester_limit >= 0)
    or (requester_mode <> 'auto_approve_to_limit' and requester_limit is null)
  ),
  constraint approver_limit_nonnegative check (approver_limit is null or approver_limit >= 0)
);

create trigger tenant_member_requisition_authority_updated_at
before update on public.tenant_member_requisition_authority
for each row execute function public.set_updated_at();

insert into public.tenant_member_requisition_authority (tenant_id, user_id)
select m.tenant_id, m.user_id
from public.tenant_members m
on conflict (tenant_id, user_id) do nothing;

create trigger audit_tenant_member_requisition_authority
after insert or update or delete on public.tenant_member_requisition_authority
for each row execute function public.capture_audit();

alter table public.tenant_member_requisition_authority enable row level security;
create policy tenant_member_requisition_authority_select
on public.tenant_member_requisition_authority for select using (
  tenant_id = public.jwt_tenant_id()
  and exists (
    select 1 from public.tenant_members m
    where m.tenant_id = tenant_member_requisition_authority.tenant_id
      and m.user_id = auth.uid()
  )
);

revoke insert, update, delete on public.tenant_member_requisition_authority
  from public, anon, authenticated;
grant select on public.tenant_member_requisition_authority to authenticated;

create or replace function public.ensure_member_requisition_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_member_requisition_authority (tenant_id, user_id)
  values (new.tenant_id, new.user_id)
  on conflict (tenant_id, user_id) do nothing;
  return new;
end;
$$;

create trigger tenant_members_requisition_authority_default
after insert on public.tenant_members
for each row execute function public.ensure_member_requisition_authority();

revoke all on function public.ensure_member_requisition_authority()
  from public, anon, authenticated, service_role;

create or replace function public.set_member_requisition_authority(
  p_tenant uuid,
  p_member uuid,
  p_requester_mode text,
  p_requester_limit numeric,
  p_approver_limit numeric
)
returns table (
  out_requester_mode text,
  out_requester_limit numeric,
  out_approver_limit numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_mode public.requisition_requester_mode;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'authority_forbidden';
  end if;
  select m.role into v_actor_role
  from public.tenant_members m
  where m.tenant_id = p_tenant and m.user_id = v_actor;
  if not found or v_actor_role <> 'owner' then raise exception 'authority_forbidden'; end if;
  if not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = p_member
  ) then raise exception 'member_not_found'; end if;

  begin
    v_mode := p_requester_mode::public.requisition_requester_mode;
  exception when invalid_text_representation then
    raise exception 'bad_requester_mode';
  end;
  if v_mode = 'auto_approve_to_limit' then
    if p_requester_limit is null or p_requester_limit < 0 then
      raise exception 'requester_limit_required';
    end if;
  elsif p_requester_limit is not null then
    raise exception 'requester_limit_not_applicable';
  end if;
  if p_approver_limit is not null and p_approver_limit < 0 then
    raise exception 'bad_approver_limit';
  end if;

  insert into public.tenant_member_requisition_authority (
    tenant_id, user_id, requester_mode, requester_limit, approver_limit, updated_by_user_id
  ) values (
    p_tenant, p_member, v_mode, p_requester_limit, p_approver_limit, v_actor
  )
  on conflict (tenant_id, user_id) do update
  set requester_mode = excluded.requester_mode,
      requester_limit = excluded.requester_limit,
      approver_limit = excluded.approver_limit,
      updated_by_user_id = excluded.updated_by_user_id;

  return query select v_mode::text, p_requester_limit, p_approver_limit;
end;
$$;

revoke all on function public.set_member_requisition_authority(uuid, uuid, text, numeric, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_requisition_authority(uuid, uuid, text, numeric, numeric)
  to authenticated;

alter table public.requisitions
  add column approval_reason text,
  add column approval_policy_snapshot jsonb;

alter table public.requisitions
  add constraint requisition_approval_reason_check check (
    approval_reason is null or approval_reason in (
      'approval_required_by_policy',
      'requester_limit_exceeded',
      'within_requester_limit',
      'unlimited_requester_authority'
    )
  );

-- Replace the version guard with a lifecycle boundary that recognizes the two
-- guarded RPC paths. The superuser/migration path (no JWT tenant) stays open for
-- seed and recovery work, matching the existing contract.
create or replace function public.enforce_requisition_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.jwt_tenant_id() is null then return new; end if;
  if new.status <> 'draft' then raise exception 'submission_rpc_required'; end if;

  if new.source_rfq_id is null then
    if new.award_version <> 1 or new.supersedes_requisition_id is not null
       or not new.is_current_version then
      raise exception 'version_metadata_guarded';
    end if;
  elsif coalesce(current_setting('app.reaward_in_progress', true), '') <> 'on' then
    raise exception 'version_metadata_guarded';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_requisition_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_policy_transition boolean :=
    coalesce(current_setting('app.requisition_policy_transition', true), '') = 'on';
  v_human_transition boolean :=
    coalesce(current_setting('app.requisition_decision_in_progress', true), '') = 'on';
begin
  if new.tenant_id <> old.tenant_id then raise exception 'tenant_immutable'; end if;
  if public.jwt_tenant_id() is null then return new; end if;
  if not old.is_current_version then raise exception 'requisition_superseded'; end if;

  if new.award_version is distinct from old.award_version
     or new.supersedes_requisition_id is distinct from old.supersedes_requisition_id
     or new.source_rfq_id is distinct from old.source_rfq_id then
    raise exception 'version_metadata_guarded';
  end if;
  if new.is_current_version is distinct from old.is_current_version then
    if not (old.is_current_version and not new.is_current_version
            and coalesce(current_setting('app.reaward_in_progress', true), '') = 'on') then
      raise exception 'version_metadata_guarded';
    end if;
  end if;
  if new.requested_by_user_id is distinct from old.requested_by_user_id then
    raise exception 'requester_immutable';
  end if;
  if old.status not in ('draft', 'rejected') and new.total is distinct from old.total then
    raise exception 'submitted_total_immutable';
  end if;

  if new.status = 'submitted' and new.status is distinct from old.status then
    if old.status not in ('draft', 'rejected') then raise exception 'bad_requisition_transition'; end if;
    if not v_policy_transition then raise exception 'submission_rpc_required'; end if;
  elsif new.status = 'approved' and new.status is distinct from old.status and v_policy_transition then
    if old.status not in ('draft', 'rejected') then raise exception 'bad_requisition_transition'; end if;
    if new.approved_by_user_id is not null or new.decided_at is null then
      raise exception 'system_decision_metadata_invalid';
    end if;
    if new.approval_reason not in ('within_requester_limit', 'unlimited_requester_authority')
       or new.approval_policy_snapshot is null then
      raise exception 'system_decision_evidence_required';
    end if;
  elsif new.status in ('approved', 'rejected') and new.status is distinct from old.status then
    if not v_human_transition then raise exception 'decision_rpc_required'; end if;
    if old.status <> 'submitted' then raise exception 'bad_requisition_transition'; end if;
    if not public.has_role('owner', 'manager') then raise exception 'approval_forbidden'; end if;
    if v_actor is null or old.requested_by_user_id is null or v_actor = old.requested_by_user_id then
      raise exception 'self_approval_forbidden';
    end if;
    if new.approved_by_user_id is distinct from v_actor or new.decided_at is null then
      raise exception 'decision_metadata_invalid';
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_note, '')), '') is null then
      raise exception 'rejection_note_required';
    end if;
  elsif new.approved_by_user_id is distinct from old.approved_by_user_id
     or new.decided_at is distinct from old.decided_at then
    raise exception 'decision_metadata_guarded';
  end if;

  if (new.approval_reason is distinct from old.approval_reason
      or new.approval_policy_snapshot is distinct from old.approval_policy_snapshot)
     and not v_policy_transition then
    raise exception 'approval_evidence_guarded';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_current_requisition_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_requisition uuid;
  v_current boolean;
  v_status public.requisition_status;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    v_requisition := old.requisition_id;
  else
    v_tenant := new.tenant_id;
    v_requisition := new.requisition_id;
  end if;
  select r.is_current_version, r.status into v_current, v_status
  from public.requisitions r
  where r.tenant_id = v_tenant and r.id = v_requisition;
  if found and not v_current then raise exception 'requisition_superseded'; end if;
  if found and public.jwt_tenant_id() is not null and v_status not in ('draft', 'rejected') then
    raise exception 'requisition_not_editable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.submit_requisition(
  p_tenant uuid,
  p_requisition uuid
)
returns table (out_status text, out_reason text, out_auto_approved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_req record;
  v_requester_role public.member_role;
  v_mode public.requisition_requester_mode := 'always_require_approval';
  v_limit numeric;
  v_total numeric;
  v_reason text;
  v_auto boolean := false;
  v_snapshot jsonb;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'submission_forbidden';
  end if;
  select m.role into v_actor_role from public.tenant_members m
  where m.tenant_id = p_tenant and m.user_id = v_actor;
  if not found or v_actor_role not in ('owner', 'manager', 'planner') then
    raise exception 'submission_forbidden';
  end if;

  select r.id, r.status, r.location_id, r.requested_by_user_id,
         r.award_version, r.is_current_version
  into v_req
  from public.requisitions r
  where r.tenant_id = p_tenant and r.id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not public.member_can_access_location(p_tenant, v_actor, v_req.location_id) then
    raise exception 'location_access_forbidden';
  end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;
  if v_req.status not in ('draft', 'rejected') then raise exception 'not_submittable'; end if;
  if v_req.requested_by_user_id is null then raise exception 'requester_required'; end if;

  select m.role, a.requester_mode, a.requester_limit
  into v_requester_role, v_mode, v_limit
  from public.tenant_members m
  join public.tenant_member_requisition_authority a
    on a.tenant_id = m.tenant_id and a.user_id = m.user_id
  where m.tenant_id = p_tenant and m.user_id = v_req.requested_by_user_id
  for share of m, a;
  if not found then raise exception 'requester_not_member'; end if;

  perform 1 from public.requisition_lines rl
  where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
  for update;
  if not found or exists (
    select 1 from public.requisition_lines rl
    where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
      and rl.unit_cost is null
  ) then raise exception 'costed_lines_required'; end if;

  select round(sum(rl.qty * rl.unit_cost), 2) into v_total
  from public.requisition_lines rl
  where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition;
  if v_total is null then raise exception 'costed_lines_required'; end if;

  if v_mode = 'auto_approve_unlimited' then
    v_auto := true;
    v_reason := 'unlimited_requester_authority';
  elsif v_mode = 'auto_approve_to_limit' and v_total <= v_limit then
    v_auto := true;
    v_reason := 'within_requester_limit';
  elsif v_mode = 'auto_approve_to_limit' then
    v_reason := 'requester_limit_exceeded';
  else
    v_reason := 'approval_required_by_policy';
  end if;

  v_snapshot := jsonb_build_object(
    'decision_actor', 'system',
    'requester_user_id', v_req.requested_by_user_id,
    'requester_role', v_requester_role,
    'requester_mode', v_mode,
    'requester_limit', v_limit,
    'evaluated_total', v_total,
    'award_version', v_req.award_version,
    'evaluated_at', now()
  );

  perform set_config('app.requisition_policy_transition', 'on', true);
  update public.requisitions r
  set status = case when v_auto then 'approved' else 'submitted' end::public.requisition_status,
      total = v_total,
      approved_by_user_id = null,
      decided_at = case when v_auto then now() else null end,
      rejection_note = null,
      approval_reason = v_reason,
      approval_policy_snapshot = v_snapshot
  where r.tenant_id = p_tenant and r.id = p_requisition;
  perform set_config('app.requisition_policy_transition', 'off', true);

  return query select case when v_auto then 'approved' else 'submitted' end, v_reason, v_auto;
end;
$$;

revoke all on function public.submit_requisition(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_requisition(uuid, uuid) to authenticated;

create or replace function public.decide_requisition(
  p_tenant uuid,
  p_requisition uuid,
  p_decision text,
  p_rejection_note text default null
)
returns table (out_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_approver_limit numeric;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'bad_decision'; end if;
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'approval_forbidden';
  end if;

  select m.role, a.approver_limit into v_actor_role, v_approver_limit
  from public.tenant_members m
  join public.tenant_member_requisition_authority a
    on a.tenant_id = m.tenant_id and a.user_id = m.user_id
  where m.tenant_id = p_tenant and m.user_id = v_actor
  for share of m, a;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'approval_forbidden';
  end if;

  select r.id, r.status, r.location_id, r.total, r.requested_by_user_id, r.is_current_version
  into v_req
  from public.requisitions r
  where r.tenant_id = p_tenant and r.id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not public.can_access_location(v_req.location_id) then raise exception 'location_access_forbidden'; end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;
  if v_req.status <> 'submitted' then raise exception 'not_submitted'; end if;
  if v_req.requested_by_user_id is null or v_actor = v_req.requested_by_user_id then
    raise exception 'self_approval_forbidden';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_rejection_note, '')), '') is null then
    raise exception 'rejection_note_required';
  end if;

  if p_decision = 'approved' then
    if v_approver_limit is not null and coalesce(v_req.total, 0) > v_approver_limit then
      raise exception 'approval_over_authority';
    end if;
  end if;

  perform set_config('app.requisition_decision_in_progress', 'on', true);
  update public.requisitions
  set status = p_decision::public.requisition_status,
      approved_by_user_id = v_actor,
      decided_at = now(),
      rejection_note = case when p_decision = 'rejected' then btrim(p_rejection_note) else null end
  where tenant_id = p_tenant and id = p_requisition;
  perform set_config('app.requisition_decision_in_progress', 'off', true);
  return query select p_decision;
end;
$$;

revoke all on function public.decide_requisition(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_requisition(uuid, uuid, text, text) to authenticated;

comment on table public.tenant_member_requisition_authority is
  'Owner-configured requester auto-approval mode/limit and independent human approver ceiling.';
comment on function public.submit_requisition(uuid, uuid) is
  'Row-locked submission and requester-authority evaluation. System auto-approval leaves no human approver and records immutable audited evidence.';
comment on function public.decide_requisition(uuid, uuid, text, text) is
  'Row-locked human decision. Owner/manager only, no self-approval, location-scoped, and bounded by the member approver ceiling when configured.';
