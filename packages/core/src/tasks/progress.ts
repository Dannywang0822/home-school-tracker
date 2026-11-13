export const PROGRESS_STATUSES = ['not_started', 'in_progress', 'submitted', 'graded'] as const;

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export interface ProgressGate {
  status: string;
  requiresSubmission: boolean;
}

export function asProgressStatus(value: unknown): ProgressStatus {
  if (value === 'not_started' || value === 'in_progress' || value === 'submitted' || value === 'graded') return value;
  return 'not_started';
}

function workflowStatus(status: string): ProgressStatus {
  if (status === 'overdue') return 'not_started';
  return asProgressStatus(status);
}

export function canStart(gate: ProgressGate): boolean {
  return workflowStatus(gate.status) === 'not_started';
}

export function canSubmit(gate: ProgressGate): boolean {
  return gate.requiresSubmission && workflowStatus(gate.status) !== 'graded';
}

export function canMarkDone(gate: ProgressGate): boolean {
  const status = workflowStatus(gate.status);
  return !gate.requiresSubmission && status !== 'graded' && status !== 'submitted';
}
