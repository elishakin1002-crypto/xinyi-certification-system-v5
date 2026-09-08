export const CONTRACT_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  CANCELLED: 'cancelled'
} as const;

export const ARCHIVE_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived'
} as const;

export const PROJECT_STATUS = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed'
} as const;

export const TASK_STATUS = {
  PENDING: 'Pending',
  /** 在做但没做完。和「还没开始」是两个信号：一个是没排上，一个是卡住了 */
  IN_PROGRESS: 'InProgress',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped'
} as const;

export const MARKET_SIGNAL_STATUS = {
  NEW: 'new',
  TRIAGED: 'triaged',
  CONVERTED: 'converted',
  IGNORED: 'ignored'
} as const;

export const RECEIVABLE_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid',
  OVERDUE: 'overdue'
} as const;

export const SETTLEMENT_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  PAID: 'paid'
} as const;

export const WORK_LOG_SOURCE = {
  MANUAL: 'manual',
  TASK_TRANSITION: 'task_transition'
} as const;
