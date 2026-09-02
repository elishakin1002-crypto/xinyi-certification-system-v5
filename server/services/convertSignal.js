// 情报→跟进项目 转化（后端）—— 忠实移植 convertSignalToFollowUpProject。
// 建情报跟进项目(intel/followup, 3任务) + 回写 signal.status=converted, convertedTo.projectId，单事务。
const { withTransaction } = require('../db/pool');
const { signalRepo } = require('../repos/batch4Repos');
const { projectRepo } = require('../repos/projectRepo');

const todayStr = () => new Date().toISOString().slice(0, 10);

const convertSignalToProject = async (signalId, opts = {}) => {
  const signal = await signalRepo.getById(signalId);
  if (!signal) return { ok: false, reason: '信号不存在' };
  if (signal.status === 'converted' && signal.convertedTo && signal.convertedTo.projectId) {
    return { ok: true, projectId: signal.convertedTo.projectId, already: true };
  }

  const nowStr = todayStr();
  const ts = Date.now();
  const projectId = `P-INTEL-${ts}`;
  const manager = opts.manager || 'ai-agent';
  const name = `【情报跟进】${signal.title || ''}`.slice(0, 60);

  const project = {
    id: projectId, name,
    /*
      contractRef 留空：这个项目**没有合同**，它是从情报线索转过来的跟进项目。

      2026-08-24 之前这里写的是 `INTEL:${signal.id}`——把来源信息塞进
      合同字段。同一份信息同时存在 contractRef 和 sourceType/sourceRef 两处，
      两处必然漂移，实测已经出现过前缀写 CUST 而 source_type 是 customer
      这类对不上的记录。

      职责分开：
        contractRef  只存真实合同 ID（CT-xxx），没有合同就留空
        sourceType   这个项目从哪来（intel / lead / customer / contract）
        sourceRef    来源对象的 ID
    */
    contractRef: '',
    sourceType: 'intel', sourceRef: signal.id, projectMode: 'followup',
    projectCategory: 'FollowUp', manager, progress: 0, status: 'Active',
    paymentStatus: 'unpaid', deadline: signal.deadline || nowStr, duration: 14, projectType: 'Self-Operated',
    tasks: [
      { id: `T-INTEL-${ts}-1`, title: '快速研判：适用范围/截止时间/申报入口', deadline: nowStr, status: 'Pending', priority: 'High', category: 'Core', owner: manager },
      { id: `T-INTEL-${ts}-2`, title: '匹配潜在客户（存量客户+同业画像）并制定触达话术', deadline: nowStr, status: 'Pending', priority: 'Medium', category: 'Auxiliary', owner: manager },
      { id: `T-INTEL-${ts}-3`, title: '建立跟进节奏：电话/微信/上门，记录反馈与下一步', deadline: nowStr, status: 'Pending', priority: 'Medium', category: 'Core', owner: manager },
    ],
    settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' },
  };

  await withTransaction(async (client) => {
    const run = (t, v) => client.query(t, v);
    await projectRepo.createWith(run, project);
    await signalRepo.updateWith(run, signalId, {
      status: 'converted',
      convertedTo: { ...(signal.convertedTo || {}), projectId },
    });
  });

  return { ok: true, projectId };
};

module.exports = { convertSignalToProject };
