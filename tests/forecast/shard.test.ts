import { describe, expect, it } from 'vitest';
import {
  type ChildState,
  halveConcurrency,
  nextLaunches,
  planShards,
  SHARD_SIZE,
} from '@/lib/forecast/shard';

describe('planShards — fan-out plan', () => {
  it('splits the catalog into 200-SKU shards, rounding up', () => {
    expect(planShards(401, 4)).toMatchObject({ total: 401, shardCount: 3, shardSize: SHARD_SIZE });
  });

  it('caps concurrency at the tenant limit', () => {
    expect(planShards(2000, 4).concurrency).toBe(4);
  });

  it('never plans more concurrency than shards', () => {
    expect(planShards(150, 4).concurrency).toBe(1);
  });

  it('handles an empty catalog with zero shards', () => {
    expect(planShards(0, 4)).toMatchObject({ total: 0, shardCount: 0, concurrency: 1 });
  });
});

describe('halveConcurrency — backpressure', () => {
  it('halves and floors', () => {
    expect(halveConcurrency(4)).toBe(2);
    expect(halveConcurrency(3)).toBe(1);
  });

  it('never drops below 1 — the run crawls, it does not stall', () => {
    expect(halveConcurrency(1)).toBe(1);
  });
});

describe('nextLaunches — fill the concurrency window in shard order', () => {
  it('launches up to the cap when nothing is in flight', () => {
    expect(nextLaunches(5, new Map(), 2).launch).toEqual([0, 1]);
  });

  it('subtracts in-flight shards from the window', () => {
    const states = new Map<number, ChildState>([
      [0, 'running'],
      [1, 'completed'],
    ]);
    expect(nextLaunches(5, states, 2).launch).toEqual([2]);
  });

  it('launches nothing when the window is full', () => {
    const states = new Map<number, ChildState>([
      [0, 'running'],
      [1, 'pending'],
    ]);
    expect(nextLaunches(5, states, 2).launch).toEqual([]);
  });

  it('does not relaunch failed shards', () => {
    const states = new Map<number, ChildState>([
      [0, 'failed'],
      [1, 'completed'],
    ]);
    expect(nextLaunches(2, states, 2).launch).toEqual([]);
  });
});
