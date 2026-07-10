/**
 * THE inventory position formula (W2-2.5, kickoff Item 2c).
 *
 * Available-to-promise position = on_hand − on_hold + in_transit − allocated.
 *
 * Held stock is still OWNED (it stays in on_hand and in valuation — MG
 * decision 2026-07-09) but it is not available: quarantined or damaged goods
 * must not silence a reorder. Every engine read of stock position (reorder
 * generation, policy derivation, what-if simulation, dashboards) calls this
 * ONE helper; a second hand-rolled `on_hand + in_transit - allocated`
 * anywhere is a bug (the kernel test greps for it).
 */

export interface PositionLevel {
  on_hand: number | string | null;
  on_hold?: number | string | null;
  in_transit: number | string | null;
  allocated: number | string | null;
}

export function netPosition(level: PositionLevel): number {
  return (
    Number(level.on_hand ?? 0) -
    Number(level.on_hold ?? 0) +
    Number(level.in_transit ?? 0) -
    Number(level.allocated ?? 0)
  );
}
