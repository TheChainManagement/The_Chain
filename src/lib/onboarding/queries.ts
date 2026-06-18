import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingCounts, OnboardingStateRow } from './state';

/**
 * Onboarding reads (Block 2). RLS-scoped to the caller's tenant; these only ever
 * shape what the tenant already owns. `head: true` counts avoid pulling rows.
 */

export async function loadOnboardingState(
  supabase: SupabaseClient,
): Promise<OnboardingStateRow | null> {
  const { data } = await supabase
    .from('onboarding_state')
    .select(
      'path, source_connected_at, catalog_minimum_met_at, suppliers_minimum_met_at, first_forecast_ready_at, completed_at, seed_only_opt_in',
    )
    .maybeSingle<OnboardingStateRow>();
  return data ?? null;
}

export async function loadOnboardingCounts(supabase: SupabaseClient): Promise<OnboardingCounts> {
  const [products, suppliers, sources] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('suppliers').select('id', { count: 'exact', head: true }),
    supabase
      .from('source_connections')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
  ]);

  return {
    products: products.count ?? 0,
    suppliers: suppliers.count ?? 0,
    sources: sources.count ?? 0,
  };
}
