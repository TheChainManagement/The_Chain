/**
 * QBO sync-conflict resolution planner (Block 6, Wave 6.3-C) — pure, no I/O.
 *
 * When the incremental sync sees BOTH sides change a QBO-owned field and can't
 * pick a winner (`needs_review`), it logs a `sync_conflicts` row and KEEPS the
 * local record. An owner/manager later adjudicates it on the `/flow/sync-conflicts`
 * cockpit, and `resolveSyncConflict` runs the choice through this planner before
 * touching the catalog.
 *
 * ## Why the planner is pure
 *
 * Same reason `conflict.ts` is pure: the resolution logic is the part that must
 * be exhaustively tested (accept_local / accept_remote / merge, each with the
 * right write + fingerprint), and the I/O wrapper around it stays thin. The
 * Server Action loads the row, calls `planConflictResolution`, applies the plan.
 *
 * ## The fingerprint stamp (the bit that's easy to get wrong)
 *
 * A `needs_review` conflict exists because the incoming remote fingerprint no
 * longer matches the baseline we stored at last sync (`external_ids.qbo_fp`).
 * Whatever the operator picks, we have now ADJUDICATED this remote state — the
 * next sync must not re-flag the same remote change. So every resolution stamps
 * `qbo_fp = fingerprint(remote_state)`: the remote we just judged becomes the new
 * baseline, regardless of which field values we end up keeping. `accept_local`
 * keeps local fields but still stamps; `accept_remote` writes remote fields and
 * stamps; `merge` writes the operator's blend and stamps. Only a genuinely NEW
 * remote change (a different fingerprint) re-opens the question.
 */

import { type AppliedResolution, productFingerprint, supplierFingerprint } from './conflict';

export type ConflictEntityType = 'product' | 'supplier';
export type ResolutionChoice = Exclude<AppliedResolution, 'pending'>;

/** A QBO-owned field shown on the reconciliation bench and eligible for merge. */
export interface FieldSpec {
  /** Canonical key as stored in local_state / remote_state. */
  key: string;
  /** Human label for the bench. */
  label: string;
  /** DB column the canonical key maps to when written back to the entity. */
  column: string;
}

/** The only fields the QBO sync writes — the diff/merge surface for products. */
export const PRODUCT_FIELDS: readonly FieldSpec[] = [
  { key: 'name', label: 'Name', column: 'name' },
  { key: 'description', label: 'Description', column: 'description' },
  { key: 'unitOfMeasure', label: 'Unit of measure', column: 'unit_of_measure' },
  { key: 'status', label: 'Status', column: 'status' },
];

/** The only fields the QBO sync writes — the diff/merge surface for suppliers. */
export const SUPPLIER_FIELDS: readonly FieldSpec[] = [
  { key: 'name', label: 'Name', column: 'name' },
  { key: 'status', label: 'Status', column: 'status' },
  { key: 'contact', label: 'Contact', column: 'contact' },
];

export function fieldsFor(entityType: ConflictEntityType): readonly FieldSpec[] {
  return entityType === 'product' ? PRODUCT_FIELDS : SUPPLIER_FIELDS;
}

/**
 * Recompute the remote fingerprint from a stored `remote_state` using the SAME
 * helper the sync uses, so the stamped baseline matches what the next pull will
 * compute for an unchanged remote.
 */
export function remoteStateFingerprint(
  entityType: ConflictEntityType,
  remoteState: Record<string, unknown>,
): string {
  if (entityType === 'product') {
    return productFingerprint({
      name: asStr(remoteState.name),
      description: asStr(remoteState.description),
      unitOfMeasure: asStr(remoteState.unitOfMeasure),
      status: asStr(remoteState.status),
    });
  }
  return supplierFingerprint({
    name: asStr(remoteState.name),
    status: asStr(remoteState.status),
    contact: remoteState.contact,
  });
}

/** Pick only the entity's canonical QBO-owned keys out of a loose state object. */
export function pickFields(
  entityType: ConflictEntityType,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldsFor(entityType)) out[f.key] = state[f.key] ?? null;
  return out;
}

/** Map canonical QBO-owned keys to the DB columns written on the entity row. */
export function toEntityColumns(
  entityType: ConflictEntityType,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldsFor(entityType)) out[f.column] = fields[f.key] ?? null;
  return out;
}

export interface ResolveInput {
  entityType: ConflictEntityType;
  resolution: ResolutionChoice;
  localState: Record<string, unknown>;
  remoteState: Record<string, unknown>;
  /** Required for `merge`: the operator's chosen value per QBO-owned field. */
  mergePayload?: Record<string, unknown> | null;
}

export interface ResolvePlan {
  /** Entity columns to write; null = keep local untouched (accept_local). */
  columnsToWrite: Record<string, unknown> | null;
  /** Fingerprint to stamp on `external_ids.qbo_fp` so the row won't re-flag. */
  newFp: string;
  /** Value recorded in `sync_conflicts.applied_resolution`. */
  applied: ResolutionChoice;
}

/**
 * Turn an operator's choice into a concrete write plan. Throws on an invalid
 * merge (no payload, or a field left unchosen) so the action can surface it
 * rather than write a half-merged row.
 */
export function planConflictResolution(i: ResolveInput): ResolvePlan {
  const newFp = remoteStateFingerprint(i.entityType, i.remoteState);

  if (i.resolution === 'accept_local') {
    return { columnsToWrite: null, newFp, applied: 'accept_local' };
  }

  if (i.resolution === 'accept_remote') {
    return {
      columnsToWrite: toEntityColumns(i.entityType, pickFields(i.entityType, i.remoteState)),
      newFp,
      applied: 'accept_remote',
    };
  }

  // merge — the operator must have chosen a value for every QBO-owned field.
  if (!i.mergePayload) throw new Error('A merge needs a value chosen for each field.');
  for (const f of fieldsFor(i.entityType)) {
    if (!(f.key in i.mergePayload)) {
      throw new Error(`Merge is missing a choice for "${f.label}".`);
    }
  }
  return {
    columnsToWrite: toEntityColumns(i.entityType, pickFields(i.entityType, i.mergePayload)),
    newFp,
    applied: 'merge',
  };
}

function asStr(v: unknown): string | null {
  return v == null ? null : String(v);
}
