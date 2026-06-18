// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AlertView } from '@/lib/alerts/queue';
import type { PurchaseOrderListRow } from '@/lib/purchase-orders/transform';
import type { ReorderGroup } from '@/lib/reorder/queue';

/**
 * Wave-1 single-location / single-user suppression (Block 15 acceptance + Codex
 * checklist): the dashboard must expose NO location selector, NO role switcher,
 * and NO tenant switcher, even though the schema permits them. Renders the real
 * server component with mocked reads and asserts the absence of those
 * affordances (plus that the core surface is present).
 */

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({}),
}));

const po: PurchaseOrderListRow = {
  id: 'po-1',
  externalPoId: null,
  reference: 'PO-1042',
  supplierId: 's1',
  supplierName: 'Atchafalaya Distributing',
  status: 'sent',
  recommendedBy: 'system',
  lineCount: 2,
  total: 1966.76,
  expectedDeliveryAt: '2026-06-20T00:00:00.000Z',
  actualDeliveryAt: null,
  updatedAt: '2026-06-15T00:00:00.000Z',
};

const group: ReorderGroup = {
  supplierId: 's1',
  supplierName: 'Atchafalaya Distributing',
  locationId: 'loc1',
  locationName: 'Primary',
  otifPct: 0.86,
  convertible: true,
  rows: [
    {
      id: 'r1',
      productId: 'p1',
      locationId: 'loc1',
      sku: 'BLT-200',
      name: 'Bolt',
      recommendedQty: 47,
      urgency: 'stockout',
      reason: {
        position: 3,
        reorderPoint: 20,
        safetyStock: 8,
        daysOfSupply: 4,
        shortfall: 17,
        computedAt: '2026-06-15T00:00:00.000Z',
        forecastId: null,
      },
    },
  ],
};

const alert: AlertView = {
  id: 'a1',
  kind: 'reorder_due',
  severity: 'critical',
  memo: 'BLT-200 hit its reorder point.',
  ctaLabel: 'Review reorder',
  ctaHref: '/reorder',
  reopenCount: 0,
  createdAt: '2026-06-15T00:00:00.000Z',
};

vi.mock('@/lib/purchase-orders/queries', () => ({
  listPurchaseOrders: async () => [po],
}));
vi.mock('@/lib/reorder/queue', () => ({
  loadReorderQueue: async () => [group],
}));
vi.mock('@/lib/alerts/queue', () => ({
  listOpenAlerts: async () => [alert],
}));
vi.mock('@/lib/dashboard/queries', () => ({
  loadSupplierOtif: async () => new Map([['s1', 0.86]]),
  countActiveProducts: async () => 3,
}));
// Legacy tenant (no onboarding_state row, has a catalog) → past the Block 2 guard.
vi.mock('@/lib/onboarding/queries', () => ({
  loadOnboardingState: async () => null,
}));
// Stub the lazy AI panels (they pull server-only insight deps) and the action.
vi.mock('@/components/InsightPanel/ReorderInsightPanel', () => ({
  ReorderInsightPanel: () => null,
}));
vi.mock('@/components/InsightPanel/WeeklyChangeInsightPanel', () => ({
  WeeklyChangeInsightPanel: () => null,
}));
vi.mock('@/app/(app)/today/actions', () => ({
  acknowledgeTopRecommendation: vi.fn(async () => ({ ok: true })),
}));

const { default: TodayPage } = await import('@/app/(app)/today/page');

describe('Today dashboard — Wave-1 suppression', () => {
  it('renders the core surface but exposes no multi-* affordances', async () => {
    const ui = await TodayPage();
    const { container } = render(ui);
    const text = container.textContent ?? '';

    // Core surface is present.
    expect(text).toContain('Today');
    expect(text).toContain('AT STOCKOUT RISK');
    expect(text).toContain('Atchafalaya Distributing');

    // No selector controls of any kind leak in.
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();

    // No location / role / tenant switching language.
    expect(text).not.toMatch(/switch tenant/i);
    expect(text).not.toMatch(/switch location/i);
    expect(text).not.toMatch(/change location/i);
    expect(text).not.toMatch(/switch role/i);
    expect(text).not.toMatch(/select (a )?location/i);
  });
});
