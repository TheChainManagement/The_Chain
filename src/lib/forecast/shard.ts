/**
 * Forecast batch sharding + backpressure (Block 8 Wave 2b) — pure, no I/O.
 *
 * The tenant batch fans out into shard workflows of SHARD_SIZE SKUs each. Shard
 * membership is NOT carried in workflow state (50k SKUs of uuids would bloat the
 * persisted run): shards are derived from the stable `order by id` position of
 * active products, so a shard re-derives its slice from (shardIndex, shardSize)
 * when it runs. A catalog edit mid-run can shift the tail slice — acceptable,
 * because every write is idempotent per (tenant, product, run) and the nightly
 * run converges.
 */

export const SHARD_SIZE = 200;
/** SKUs forecast per durable step inside a shard (one step = one retry unit). */
export const CHUNK_SIZE = 25;
/** Poll cadence + cap for the parent loop: 15s × 240 = 1 hour before timeout. */
export const POLL_INTERVAL = '15s';
export const MAX_POLLS = 240;

export interface ShardPlan {
  total: number;
  shardCount: number;
  shardSize: number;
  /** Effective starting concurrency for the run. */
  concurrency: number;
}

/** Plan the fan-out for `total` SKUs under the tenant's concurrency limit. */
export function planShards(total: number, concurrencyLimit: number): ShardPlan {
  const shardCount = Math.ceil(Math.max(0, total) / SHARD_SIZE);
  return {
    total: Math.max(0, total),
    shardCount,
    shardSize: SHARD_SIZE,
    concurrency: Math.max(1, Math.min(concurrencyLimit, Math.max(shardCount, 1))),
  };
}

/**
 * Backpressure (FEATURES: shard failures halve concurrency for the run).
 * Floor of 1 — the run always crawls forward rather than stalling.
 */
export function halveConcurrency(current: number): number {
  return Math.max(1, Math.floor(current / 2));
}

export type ChildState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface LaunchDecision {
  /** Shard indices to launch this cycle. */
  launch: number[];
}

/**
 * Which shards to launch next, given child states so far. Launches enough to
 * fill `concurrency` minus the shards still in flight, in shard order.
 */
export function nextLaunches(
  shardCount: number,
  states: Map<number, ChildState>,
  concurrency: number,
): LaunchDecision {
  let active = 0;
  for (const s of states.values()) {
    if (s === 'pending' || s === 'running') active++;
  }
  const launch: number[] = [];
  for (let i = 0; i < shardCount && active + launch.length < concurrency; i++) {
    if (!states.has(i)) launch.push(i);
  }
  return { launch };
}
