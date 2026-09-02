// /transaction 批量落 PG：把前端发来的数据集（整批数组）幂等 upsert 到对应 PG 表，单事务。
// 已迁 PG 的数据集写 PG，其余（如 project_work_logs_v1）写 state store——都不丢。
const { withTransaction } = require('../db/pool');
const { projectRepo } = require('../repos/projectRepo');
const { customerRepo } = require('../repos/customerRepo');
const { reminderRepo } = require('../repos/reminderRepo');
const { knowledgeRepo } = require('../repos/knowledgeRepo');
const { contractRepo } = require('../repos/contractRepo');
const { settlementRepo } = require('../repos/settlementRepo');
const { leadRepo } = require('../repos/leadRepo');

const REPO_BY_KEY = {
  leads_v8: leadRepo,
  projects_v8: projectRepo,
  customers_v8: customerRepo,
  reminders_v8: reminderRepo,
  knowledge_docs_v8: knowledgeRepo,
  contracts_v8: contractRepo,
  settlements_v8: settlementRepo,
};

// body 可能是 { datasets:{...} } 或直接 {...key:[]}
const extractDatasets = (body = {}) => {
  if (body && typeof body.datasets === 'object' && body.datasets) return body.datasets;
  return body && typeof body === 'object' ? body : {};
};

/*
  事务接口允许写入的数据集（见 docs/projects-api-contract.md 与 contracts-api-contract.md）。
  不在这张表里的键一律忽略——调用方多塞什么进来都不会被落库。

  这里面有些还没有 PG 表（典型的是 project_work_logs_v1，见待办 P0-19），
  它们落回 state store。**关键是不能静默丢掉**：
  2026-08-21 之前的实现只处理有 PG 表的键，前端发 5 个数据集只写 4 个，
  工作日志被直接丢弃——它们没丢只是因为前端另有一条批量写也存了一份。
  靠冗余侥幸没丢，不是设计；哪天那条路改了就是真丢数据。
*/
const ALLOWED_KEYS = new Set([
  ...Object.keys(REPO_BY_KEY),
  'project_work_logs_v1',
  'audit_issues_v1',
]);

const upsertDatasets = async (datasets) => {
  const allKeys = Object.keys(datasets).filter((k) => ALLOWED_KEYS.has(k) && Array.isArray(datasets[k]));
  const pgKeys = allKeys.filter((k) => REPO_BY_KEY[k]);
  const legacyKeys = allKeys.filter((k) => !REPO_BY_KEY[k]);

  let written = 0;
  await withTransaction(async (client) => {
    const run = (t, v) => client.query(t, v);
    for (const k of pgKeys) {
      const repo = REPO_BY_KEY[k];
      for (const rec of datasets[k]) {
        if (!rec || !rec.id) continue;
        await repo.upsertWith(run, rec);
        written++;
      }
    }
  });

  // 还没迁 PG 的数据集：落 state store。
  // 放在 PG 事务之外——两种存储没法共用一个事务，
  // 硬凑只会得到一个假的原子性。PG 写失败会抛，这里就不会执行。
  if (legacyKeys.length) {
    const { upsertStateBatch } = require('../stateStore');
    const payload = {};
    for (const k of legacyKeys) payload[k] = datasets[k];
    await upsertStateBatch(payload, { clientId: 'tx-upsert', appVersion: 'transaction-legacy' });
    for (const k of legacyKeys) written += datasets[k].filter((r) => r && r.id).length;
  }

  return { written, keys: allKeys };
};

module.exports = { upsertDatasets, extractDatasets };
