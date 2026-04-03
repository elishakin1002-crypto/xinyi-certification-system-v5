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
  COMPLETED: 'Completed'
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
