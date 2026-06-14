-- ============================================================
-- In-app alerts engine — dedupe / severity-rise / auto-close
-- ============================================================
-- The Foundation built the `alerts` table + the unique partial index
-- (tenant_id, dedupe_key) WHERE status='open'. This wave gives it the atomic
-- write contract from SYSTEM_DESIGN.md §Alert generation contract.
--
-- Spec reconciliation: the contract says, on a severity RISE, "insert a new row
-- with reopen_count+1 and leave the prior row open." Two open rows with the same
-- dedupe_key is impossible under the unique partial index. We resolve it the way
-- that satisfies BOTH the "new row on re-alert" intent AND the index: the prior
-- open row is moved to a new terminal status `superseded`, and a fresh `open`
-- row is inserted carrying reopen_count+1. `auto_closed` stays reserved for a
-- genuinely-cleared condition; `superseded` means "escalated to a higher-severity
-- alert," so the escalation history reads honestly.

-- `superseded` must be committed before any row uses it; a CREATE FUNCTION body
-- only references it as a literal (not executed here), so this is safe in-migration.
alter type alert_status add value if not exists 'superseded';

-- info < warn < critical.
create or replace function alert_severity_rank(p public.alert_severity)
returns int language sql immutable set search_path = '' as $$
  select case p when 'info' then 0 when 'warn' then 1 when 'critical' then 2 end;
$$;

-- ----- upsert_alert: the dedupe + severity contract, atomic per alert -----

create or replace function upsert_alert(
  p_tenant uuid,
  p_kind text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_key text,
  p_severity text,
  p_payload jsonb
)
returns table (out_alert_id uuid, out_action text, out_reopen_count int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing record;
  v_new_id uuid;
  v_rank_new int;
  v_rank_old int;
begin
  -- Lock the open row for this key (if any) so concurrent generation runs can't
  -- both escalate or both insert.
  select id, severity, last_severity, reopen_count, condition_first_seen_at
    into v_existing
  from public.alerts
  where tenant_id = p_tenant and dedupe_key = p_dedupe_key and status = 'open'
  for update;

  if not found then
    insert into public.alerts
      (tenant_id, kind, entity_type, entity_id, dedupe_key, severity, last_severity, payload)
    values
      (p_tenant, p_kind::public.alert_kind, p_entity_type, p_entity_id, p_dedupe_key,
       p_severity::public.alert_severity, p_severity::public.alert_severity, p_payload)
    returning id into v_new_id;
    return query select v_new_id, 'created'::text, 0;
    return;
  end if;

  v_rank_new := public.alert_severity_rank(p_severity::public.alert_severity);
  v_rank_old := public.alert_severity_rank(v_existing.severity);

  if v_rank_new > v_rank_old then
    -- Escalation: supersede the prior open row, open a fresh one (+1 reopen).
    update public.alerts
      set status = 'superseded', last_severity = p_severity::public.alert_severity
      where id = v_existing.id;

    insert into public.alerts
      (tenant_id, kind, entity_type, entity_id, dedupe_key, severity, last_severity,
       condition_first_seen_at, reopen_count, payload)
    values
      (p_tenant, p_kind::public.alert_kind, p_entity_type, p_entity_id, p_dedupe_key,
       p_severity::public.alert_severity, p_severity::public.alert_severity,
       v_existing.condition_first_seen_at, v_existing.reopen_count + 1, p_payload)
    returning id into v_new_id;
    return query select v_new_id, 'escalated'::text, v_existing.reopen_count + 1;
    return;
  end if;

  -- Same or lower severity: keep the row, refresh its payload + touch updated_at.
  update public.alerts
    set payload = p_payload, updated_at = now()
    where id = v_existing.id;
  return query select v_existing.id, 'held'::text, v_existing.reopen_count;
end;
$$;

comment on function upsert_alert(uuid, text, text, uuid, text, text, jsonb) is
  'Atomic alert dedupe (SYSTEM_DESIGN §Alert generation contract): one open row '
  'per (tenant, dedupe_key). Severity rise supersedes the prior open row and '
  'opens a fresh one with reopen_count+1; same/lower refreshes payload + '
  'updated_at. Returns the live alert id + action (created|escalated|held).';

-- ----- close_stale_alerts: auto-close conditions that no longer fire -----

create or replace function close_stale_alerts(
  p_tenant uuid,
  p_kinds text[],
  p_active_keys text[]
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_closed int;
begin
  -- Of the kinds this generation run evaluated, close any OPEN alert whose
  -- dedupe_key was not among the conditions that fired this run.
  update public.alerts
    set status = 'auto_closed'
    where tenant_id = p_tenant
      and status = 'open'
      and kind = any(p_kinds::public.alert_kind[])
      and not (dedupe_key = any(p_active_keys));
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

comment on function close_stale_alerts(uuid, text[], text[]) is
  'Auto-close OPEN alerts of the evaluated kinds whose condition no longer fires '
  '(dedupe_key absent from this run active set). p_active_keys may be empty.';
