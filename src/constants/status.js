const CONTRACT_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  CANCELLED: 'cancelled'
};

const PROJECT_STATUS = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed'
};

const TASK_STATUS = {
  PENDING: 'Pending',
  COMPLETED: 'Completed'
};

const MARKET_SIGNAL_STATUS = {
  NEW: 'new',
  TRIAGED: 'triaged',
  CONVERTED: 'converted',
  IGNORED: 'ignored'
};

const RECEIVABLE_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid',
  OVERDUE: 'overdue'
};

const SETTLEMENT_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  PAID: 'paid'
};

module.exports = {
  CONTRACT_STATUS,
  PROJECT_STATUS,
  TASK_STATUS,
  MARKET_SIGNAL_STATUS,
  RECEIVABLE_STATUS,
  SETTLEMENT_STATUS
};
