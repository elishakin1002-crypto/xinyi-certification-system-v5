// 批次4 repos：情报信号 / 审计问题 / 战略任务（均用通用工厂）。
const { makeRepo } = require('./_factory');

const signalRepo = makeRepo({
  table: 'market_signals',
  idPrefix: 'SIG',
  filters: { kind: 'kind', status: 'signal_status', urgency: 'urgency', ownerUserId: 'owner_user_id' },
  orderBy: 'score DESC, created_at DESC',
  spec: [
    { api: 'id', col: 'id', kind: 'text' },
    { api: 'title', col: 'title', kind: 'text' },
    { api: 'sourceName', col: 'source_name', kind: 'text' },
    { api: 'sourceUrl', col: 'source_url', kind: 'text' },
    { api: 'publishedAt', col: 'published_at', kind: 'date' },
    { api: 'summary', col: 'summary', kind: 'text' },
    { api: 'content', col: 'content', kind: 'text' },
    { api: 'kind', col: 'kind', kind: 'text' },
    { api: 'regions', col: 'regions', kind: 'json' },
    { api: 'industries', col: 'industries', kind: 'json' },
    { api: 'departments', col: 'departments', kind: 'json' },
    { api: 'tags', col: 'tags', kind: 'json' },
    { api: 'deadline', col: 'deadline', kind: 'date' },
    { api: 'serviceCategory', col: 'service_category', kind: 'text' },
    { api: 'serviceItemCode', col: 'service_item_code', kind: 'text' },
    { api: 'opportunityHypothesis', col: 'opportunity_hypothesis', kind: 'json' },
    { api: 'recommendedActions', col: 'recommended_actions', kind: 'json' },
    { api: 'score', col: 'score', kind: 'int' },
    { api: 'urgency', col: 'urgency', kind: 'text' },
    { api: 'status', col: 'signal_status', kind: 'text' },
    { api: 'ownerUserId', col: 'owner_user_id', kind: 'text' },
    { api: 'convertedTo', col: 'converted_to', kind: 'json' },
  ],
});

const auditRepo = makeRepo({
  table: 'audit_issues',
  idPrefix: 'AUD',
  filters: { status: 'issue_status', customerId: 'customer_id', severity: 'severity' },
  spec: [
    { api: 'id', col: 'id', kind: 'text' },
    { api: 'customerName', col: 'customer_name', kind: 'text' },
    { api: 'customerId', col: 'customer_id', kind: 'text' },
    { api: 'projectId', col: 'project_id', kind: 'text' },
    { api: 'contractId', col: 'contract_id', kind: 'text' },
    { api: 'findings', col: 'findings', kind: 'text' },
    { api: 'severity', col: 'severity', kind: 'text' },
    { api: 'status', col: 'issue_status', kind: 'text' },
    { api: 'auditor', col: 'auditor', kind: 'text' },
    { api: 'rectificationPlan', col: 'rectification_plan', kind: 'text' },
    { api: 'auditType', col: 'audit_type', kind: 'text' },
    { api: 'createDate', col: 'create_date', kind: 'date' },
    { api: 'deadline', col: 'deadline', kind: 'date' },
    { api: 'contractRef', col: 'contract_ref', kind: 'text' },
    { api: 'rectificationTaskId', col: 'rectification_task_id', kind: 'text' },
    { api: 'knowledgeDocId', col: 'knowledge_doc_id', kind: 'text' },
    { api: 'evidences', col: 'evidences', kind: 'json' },
    { api: 'verification', col: 'verification', kind: 'json' },
  ],
});

const strategicRepo = makeRepo({
  table: 'strategic_tasks',
  idPrefix: 'STK',
  filters: { status: 'task_status', priority: 'priority', owner: 'owner' },
  spec: [
    { api: 'id', col: 'id', kind: 'text' },
    { api: 'title', col: 'title', kind: 'text' },
    { api: 'status', col: 'task_status', kind: 'text' },
    { api: 'priority', col: 'priority', kind: 'text' },
    { api: 'owner', col: 'owner', kind: 'text' },
    { api: 'deadline', col: 'deadline', kind: 'date' },
    { api: 'impact', col: 'impact', kind: 'text' },
    { api: 'type', col: 'task_type', kind: 'text' },
  ],
});

module.exports = { signalRepo, auditRepo, strategicRepo };
