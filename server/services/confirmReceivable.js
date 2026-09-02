// 回款确认级联（后端原子版）—— 忠实移植 AppContext 的回款确认逻辑。
// 切换某回款 paid/unpaid → 重算关联项目 paymentStatus → 全额回款时更新客户(分级/累计额/pdcaPaidContractIds) + 生成 PDCA 文档。
const { withTransaction } = require('../db/pool');
const { contractRepo } = require('../repos/contractRepo');
const { businessEventRepo } = require('../repos/businessEventRepo');
const { projectRepo } = require('../repos/projectRepo');
const { customerRepo } = require('../repos/customerRepo');
const { knowledgeRepo } = require('../repos/knowledgeRepo');
const { buildPdcaKnowledgeDoc, resolvePDCAContext } = require('./completeProject');

const deriveReceivableStatus = (r, nowMs = Date.now()) => {
  if (r.status === 'paid') return 'paid';
  const dueMs = Date.parse(r.dueDate || '');
  if (!Number.isFinite(dueMs)) return r.status === 'overdue' ? 'overdue' : 'unpaid';
  return dueMs < nowMs ? 'overdue' : 'unpaid';
};

const deriveProjectPaymentStatus = (receivables) => {
  if (!Array.isArray(receivables) || receivables.length === 0) return 'unpaid';
  const paid = receivables.filter((r) => r.status === 'paid').length;
  if (paid === receivables.length) return 'paid';
  if (receivables.some((r) => r.status === 'overdue')) return 'overdue';
  return paid > 0 ? 'partial' : 'unpaid';
};

/**
 * @param actor 操作人 { id, name, viaAiAgent, onBehalfOf }。
 *   可选是为了不破坏现有调用方；但**金额动作必须能追溯到人**，
 *   所以路由层一定要传。不传时 Ledger 里 actor 为空，能一眼看出是谁漏了。
 */
const confirmReceivable = async (contractId, receivableId, actor = null) => {
  const contract = await contractRepo.getById(contractId);
  if (!contract) return { ok: false, reason: '合同不存在' };
  const receivables = Array.isArray(contract.receivables) ? contract.receivables : [];
  if (!receivables.some((r) => r.id === receivableId)) return { ok: false, reason: '回款节点不存在' };

  const nextReceivables = receivables.map((r) => {
    if (r.id !== receivableId) return r;
    if (r.status === 'paid') return { ...r, status: deriveReceivableStatus({ ...r, status: 'unpaid' }) };
    return { ...r, status: 'paid' };
  });
  const allPaid = nextReceivables.length > 0 && nextReceivables.every((r) => r.status === 'paid');
  const nextPaymentStatus = deriveProjectPaymentStatus(nextReceivables);

  // 关联项目（contractRef 命中 id 或 contractNo）
  const allProjects = await projectRepo.list();
  const relatedProjects = allProjects.filter((p) => p.contractRef === contract.id || (contract.contractNo && p.contractRef === contract.contractNo));

  // 全额回款 → 目标客户 PDCA
  let targetCustomer = null;
  let customerPatch = null;
  let pdcaDoc = null;
  if (allPaid) {
    const relatedProject = relatedProjects[0];
    targetCustomer =
      (contract.customerId ? await customerRepo.getById(contract.customerId) : null) ||
      (relatedProject?.customerId ? await customerRepo.getById(relatedProject.customerId) : null) ||
      (contract.customerName ? await customerRepo.findByName(contract.customerName) : null);

    if (targetCustomer) {
      const nowStr = new Date().toISOString().slice(0, 10);
      const alreadyCounted = (targetCustomer.pdcaPaidContractIds || []).includes(contract.id);
      const ctxProject = relatedProject || { id: 'P-PAYMENT', name: `${contract.customerName} - ${contract.serviceLine || contract.title}`, contractRef: contract.id, manager: contract.contactPerson || '待指派', tasks: [], projectType: 'Self-Operated' };
      const { projectTypeLabel, nextOpportunity } = resolvePDCAContext(ctxProject, contract);

      if (!alreadyCounted) {
        const addAmount = Number(contract.amount || 0); // 元（repo 边界）
        const currentYear = new Date().getFullYear();
        const isCurrentYear = nowStr.startsWith(String(currentYear));
        const totalAmount = (targetCustomer.totalAmount || 0) + addAmount;
        const yearAmount = (targetCustomer.yearAmount || 0) + (isCurrentYear ? addAmount : 0);
        const level = totalAmount >= 100000 ? 'A' : totalAmount >= 30000 ? 'B' : 'C';
        customerPatch = { lastProjectAt: nowStr, lastProjectType: projectTypeLabel, nextOpportunity, totalAmount, yearAmount, level, pdcaPaidContractIds: [...(targetCustomer.pdcaPaidContractIds || []), contract.id] };
      }

      const pdcaDocs = await knowledgeRepo.list({ category: 'PDCA' });
      const hasDoc = pdcaDocs.some((d) => (d.tags || []).includes(`contract:${contract.id}`));
      if (!hasDoc) {
        pdcaDoc = buildPdcaKnowledgeDoc({ customer: targetCustomer, contract, project: relatedProject || ctxProject, projectTypeLabel, nextOpportunity });
      }
    }
  }

  await withTransaction(async (client) => {
    const run = (t, v) => client.query(t, v);
    await contractRepo.updateWith(run, contract.id, { receivables: nextReceivables });
    for (const p of relatedProjects) {
      if (p.paymentStatus !== nextPaymentStatus) await projectRepo.updateWith(run, p.id, { paymentStatus: nextPaymentStatus });
    }
    if (customerPatch && targetCustomer) await customerRepo.updateWith(run, targetCustomer.id, customerPatch);
    if (pdcaDoc) await knowledgeRepo.createWith(run, pdcaDoc);
  });

  /*
    写 Action Ledger。金额动作是最需要追溯的一类——
    我自己就误点过一次「确认到账」，当时只能靠比对 updated_at 才查出来。
    有了这条记录，谁在什么时候把哪一笔标成到账、金额多少，一目了然。
    记录失败不影响主流程（repo 内部吞异常）。
  */
  const target = receivables.find((r) => r.id === receivableId);
  const wasPaid = target?.status === 'paid';
  await businessEventRepo.record({
    eventType: wasPaid ? 'receivable.unconfirmed' : 'receivable.confirmed',
    subjectType: 'contract',
    subjectId: contract.id,
    actorUserId: actor?.id || '',
    actorName: actor?.name || '',
    viaAiAgent: Boolean(actor?.viaAiAgent),
    onBehalfOf: actor?.onBehalfOf || null,
    summary: `${wasPaid ? '撤销到账' : '确认到账'}「${target?.node || receivableId}」¥${Number(target?.amount || 0).toLocaleString()}`,
    reason: actor?.reason || null,
    policy: actor?.policy || null,
    aiLevel: actor?.aiLevel || null,
    result: 'success',
    detail: {
      receivableId,
      amountYuan: Number(target?.amount || 0),
      before: { status: target?.status, projectPaymentStatus: relatedProjects[0]?.paymentStatus },
      after: { status: wasPaid ? 'unpaid' : 'paid', projectPaymentStatus: nextPaymentStatus },
      cascade: { allPaid, customerLeveledUp: !!customerPatch, pdcaDocId: pdcaDoc?.id || null },
    },
  });

  return { ok: true, allPaid, paymentStatus: nextPaymentStatus, customerId: targetCustomer?.id, pdcaDocId: pdcaDoc?.id, leveledUp: !!customerPatch };
};

module.exports = { confirmReceivable, deriveReceivableStatus, deriveProjectPaymentStatus };
