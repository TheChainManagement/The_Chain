import { describe, expect, it } from 'vitest';
import {
  chooseLeadTime,
  clampServiceLevel,
  demandStatsFromPoints,
  derivePolicy,
  invNorm,
  normCdf,
} from '@/lib/policy/compute';

describe('invNorm — service-level z-scores', () => {
  it('matches the standard table', () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 6);
    expect(invNorm(0.95)).toBeCloseTo(1.6449, 4);
    expect(invNorm(0.97)).toBeCloseTo(1.8808, 4);
    expect(invNorm(0.995)).toBeCloseTo(2.5758, 4);
  });

  it('is symmetric', () => {
    expect(invNorm(0.05)).toBeCloseTo(-invNorm(0.95), 6);
  });

  it('refuses the degenerate boundaries', () => {
    expect(() => invNorm(0)).toThrow();
    expect(() => invNorm(1)).toThrow();
  });
});

describe('normCdf', () => {
  it('matches the standard table and inverts invNorm', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.6449)).toBeCloseTo(0.95, 3);
    expect(normCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normCdf(invNorm(0.97))).toBeCloseTo(0.97, 3);
  });
});

describe('clampServiceLevel — the 90–99.5% slider rail', () => {
  it('clamps both ends and defaults NaN', () => {
    expect(clampServiceLevel(0.85)).toBe(0.9);
    expect(clampServiceLevel(0.999)).toBe(0.995);
    expect(clampServiceLevel(0.97)).toBe(0.97);
    expect(clampServiceLevel(Number.NaN)).toBe(0.97);
  });
});

describe('demandStatsFromPoints — the model’s own uncertainty', () => {
  const point = (mean: number, lo80: number, hi80: number) => ({
    mean,
    lo80,
    hi80,
    lo95: lo80 - 2,
    hi95: hi80 + 2,
  });

  it('derives weekly mean and band-implied daily σ', () => {
    // hi80 − lo80 = 5.126 → σ_w = 5.126 / (2·1.28155) = 2.0 → σ_d = 2/√7.
    const stats = demandStatsFromPoints([point(14, 11.437, 16.563), point(14.2, 11, 17)]);
    expect(stats?.dailyMean).toBeCloseTo(14.1 / 7, 3);
    expect(stats?.dailySigma).toBeCloseTo(2 / Math.sqrt(7), 3);
  });

  it('falls back to the 95% band when 80% is absent', () => {
    const stats = demandStatsFromPoints([
      { mean: 14, lo80: null, hi80: null, lo95: 10.08, hi95: 17.92 },
    ]);
    // hi95 − lo95 = 7.84 → σ_w = 7.84 / (2·1.95996) = 2.0
    expect(stats?.dailySigma).toBeCloseTo(2 / Math.sqrt(7), 3);
  });

  it('returns null with no means or no bands (benchmark fills)', () => {
    expect(demandStatsFromPoints([])).toBeNull();
    expect(
      demandStatsFromPoints([{ mean: 9.4, lo80: null, hi80: null, lo95: null, hi95: null }]),
    ).toBeNull();
  });
});

describe('derivePolicy — safety stock, ROP, ROQ, DOS, risk', () => {
  const base = {
    dailyMean: 4,
    dailySigma: 1.2,
    leadTimeDays: 9,
    leadSigmaDays: 0,
    serviceLevel: 0.97,
    moq: null,
    coverageDays: 56,
    position: 60 as number | null,
  };

  it('reduces to the classic z·σ·√L when lead-time σ is zero', () => {
    const p = derivePolicy(base);
    expect(p.safetyStock).toBeCloseTo(1.8808 * 1.2 * Math.sqrt(9), 2);
    expect(p.demandDuringLeadTime).toBeCloseTo(36, 6);
    expect(p.reorderPoint).toBeCloseTo(p.demandDuringLeadTime + p.safetyStock, 6);
  });

  it('lead-time variability widens safety stock', () => {
    const without = derivePolicy(base);
    const withSigma = derivePolicy({ ...base, leadSigmaDays: 2.5 });
    expect(withSigma.safetyStock).toBeGreaterThan(without.safetyStock);
  });

  it('recommended qty covers the horizon and respects the MOQ floor', () => {
    expect(derivePolicy(base).recommendedOrderQty).toBe(224); // 4 × 56
    expect(derivePolicy({ ...base, moq: 500 }).recommendedOrderQty).toBe(500);
  });

  it('DOS is position over daily demand; null without a position', () => {
    expect(derivePolicy(base).daysOfSupply).toBeCloseTo(15, 6);
    expect(derivePolicy({ ...base, position: null }).daysOfSupply).toBeNull();
  });

  it('risk is exactly 50% when the position sits ON the reorder point', () => {
    const p = derivePolicy(base);
    const atRop = derivePolicy({ ...base, position: p.reorderPoint });
    expect(atRop.stockoutRisk).toBeCloseTo(0.5, 3);
  });

  it('risk falls toward 0 with deep stock and rises toward 1 when empty', () => {
    expect(derivePolicy({ ...base, position: 500 }).stockoutRisk).toBeLessThan(0.001);
    expect(derivePolicy({ ...base, position: 0 }).stockoutRisk).toBeGreaterThan(0.999);
  });

  it('degenerate σ gives a deterministic verdict, not NaN', () => {
    const p = derivePolicy({ ...base, dailySigma: 0, position: 10 });
    expect(p.stockoutRisk).toBe(1); // 36 demand vs 10 on hand
    const q = derivePolicy({ ...base, dailySigma: 0, position: 100 });
    expect(q.stockoutRisk).toBe(0);
  });

  it('clamps a wild service level before computing z', () => {
    const p = derivePolicy({ ...base, serviceLevel: 0.85 });
    expect(p.z).toBeCloseTo(invNorm(0.9), 6);
  });
});

describe('chooseLeadTime — supplier setting vs scorecard empirical', () => {
  it('uses the configured supplier lead time when the scorecard sample is thin', () => {
    const choice = chooseLeadTime(9, { avgDays: 11.4, stddevDays: 2.1, sampleSize: 3 });
    expect(choice).toMatchObject({ days: 9, sigmaDays: 0, source: 'supplier' });
  });

  it('switches to the empirical scorecard at sample_size ≥ 5', () => {
    const choice = chooseLeadTime(9, { avgDays: 11.4, stddevDays: 2.1, sampleSize: 5 });
    expect(choice).toMatchObject({ days: 11.4, sigmaDays: 2.1, source: 'scorecard' });
  });

  it('returns null with neither — a SKU is skipped, never defaulted', () => {
    expect(chooseLeadTime(null, null)).toBeNull();
    expect(chooseLeadTime(null, { avgDays: null, stddevDays: null, sampleSize: 9 })).toBeNull();
  });
});
