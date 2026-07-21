export const REQUISITION_REQUESTER_MODES = [
  'always_require_approval',
  'auto_approve_to_limit',
  'auto_approve_unlimited',
] as const;

export type RequisitionRequesterMode = (typeof REQUISITION_REQUESTER_MODES)[number];

export const REQUISITION_REQUESTER_MODE_LABELS: Record<RequisitionRequesterMode, string> = {
  always_require_approval: 'Always require approval',
  auto_approve_to_limit: 'Approve automatically up to a limit',
  auto_approve_unlimited: 'Approve automatically with no limit',
};

export function isRequisitionRequesterMode(value: string): value is RequisitionRequesterMode {
  return REQUISITION_REQUESTER_MODES.includes(value as RequisitionRequesterMode);
}
