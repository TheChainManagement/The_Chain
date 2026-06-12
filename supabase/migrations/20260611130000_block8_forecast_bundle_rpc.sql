-- ============================================================
-- Block 8 Wave 2b (Codex round-1) — atomic forecast bundle insert
-- ============================================================
-- A forecast is only meaningful as its BUNDLE: the forecasts row + its points +
-- its evaluation. The chunk previously inserted them as three statements; a
-- crash between them left a forecasts row without points/evaluation, and the
-- rerun's skip-done check would then never repair it. This RPC inserts a whole
-- chunk's bundles in ONE transaction (the FEATURES step-4 contract), so partial
-- bundles cannot exist and the skip-done check is safe.
--
-- ON CONFLICT on the per-run unique index makes the call idempotent: a bundle
-- whose forecasts row already landed is skipped entirely (its points/evaluation
-- are known-complete, because bundles are atomic).
--
-- SECURITY INVOKER: called by the service-role batch path only (forecast tables
-- are system-write). search_path pinned per the function-hardening convention.

create or replace function insert_forecast_bundles(p_bundles jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bundle jsonb;
  v_forecast jsonb;
  v_id uuid;
  v_tenant uuid;
  inserted int := 0;
begin
  for bundle in select * from jsonb_array_elements(p_bundles)
  loop
    v_forecast := bundle->'forecast';
    v_tenant := (v_forecast->>'tenant_id')::uuid;

    insert into public.forecasts
      (tenant_id, product_id, location_id, aggregation_level, method, horizon_days,
       confidence_level, training_cutoff_at, eligibility_threshold_met,
       cold_start_state, promoted, run_id, computed_at)
    values
      (v_tenant,
       (v_forecast->>'product_id')::uuid,
       (v_forecast->>'location_id')::uuid,
       (v_forecast->>'aggregation_level')::public.forecast_aggregation_level,
       (v_forecast->>'method')::public.forecast_method,
       (v_forecast->>'horizon_days')::int,
       (v_forecast->>'confidence_level')::numeric,
       (v_forecast->>'training_cutoff_at')::timestamptz,
       (v_forecast->>'eligibility_threshold_met')::bool,
       (v_forecast->>'cold_start_state')::public.cold_start_state,
       (v_forecast->>'promoted')::bool,
       (v_forecast->>'run_id')::uuid,
       (v_forecast->>'computed_at')::timestamptz)
    on conflict (tenant_id, product_id,
                 coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), run_id)
      do nothing
    returning id into v_id;

    if v_id is null then
      continue; -- bundle already landed atomically in a prior attempt
    end if;

    insert into public.forecast_points
      (tenant_id, forecast_id, period_date, mean, lower_bound, upper_bound,
       lower_bound_80, upper_bound_80)
    select v_tenant, v_id,
           (p->>'period_date')::date,
           (p->>'mean')::numeric,
           (p->>'lower_bound')::numeric,
           (p->>'upper_bound')::numeric,
           (p->>'lower_bound_80')::numeric,
           (p->>'upper_bound_80')::numeric
    from jsonb_array_elements(coalesce(bundle->'points', '[]'::jsonb)) as p;

    if bundle ? 'evaluation' and bundle->'evaluation' is not null
       and jsonb_typeof(bundle->'evaluation') = 'object' then
      insert into public.forecast_evaluations
        (tenant_id, forecast_id, baseline_method, baseline_forecast_values,
         rolling_origin_windows, rmsse, wape, beats_baseline)
      values
        (v_tenant, v_id,
         coalesce((bundle->'evaluation'->>'baseline_method')::public.forecast_method,
                  'seasonal_naive'),
         bundle->'evaluation'->'baseline_forecast_values',
         (bundle->'evaluation'->>'rolling_origin_windows')::int,
         (bundle->'evaluation'->>'rmsse')::numeric,
         (bundle->'evaluation'->>'wape')::numeric,
         (bundle->'evaluation'->>'beats_baseline')::bool);
    end if;

    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;

comment on function insert_forecast_bundles(jsonb) is
  'Atomic per-chunk insert of forecast bundles (forecasts + points + evaluation). '
  'Idempotent on the per-run unique index; partial bundles cannot exist.';
