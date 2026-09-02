// 项目完成级联（后端原子版）—— 忠实移植 context/AppContext.tsx 的 completeProject。
// 在单事务内：标记项目完成 + PDCA 找/建客户 + 更新客户分级/累计额 + 生成提醒 + 生成 PDCA 知识文档。
// 操作均为 repo 返回的「元」单位对象，分级阈值沿用原逻辑（元）。
const { withTransaction } = require('../db/pool');

/*
  标准识别规则**从 src/modules/knowledge/standards.ts 取**，不在这里另抄一份。

  这个文件原来自己维护一份 STANDARD_PATTERNS，前端 AppContext 也有一份——
  2026-08-24 查出两边已经漂移：服务端那份带标准号、可信层级、行业标签，
  前端那份只有标题和分类。同一个业务动作，产出的复盘质量取决于一个环境变量。

  服务端是 CommonJS、共用模块是 TypeScript，所以这里用 tsc 转译后加载。
  转译一次缓存住，不影响每次调用的性能。
*/
let sharedStandards = null;
const loadSharedStandards = () => {
  if (sharedStandards) return sharedStandards;
  const ts = require('typescript');
  const fs = require('fs');
  const path = require('path');
  const file = path.resolve(__dirname, '../../src/modules/knowledge/standards.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', outputText)(mod, mod.exports);
  sharedStandards = mod.exports;
  return sharedStandards;
};

const detectStandards = (...texts) => loadSharedStandards().detectStandards(...texts);
const buildPdcaTitle = (customerName, serviceLabel, standards) =>
  loadSharedStandards().buildPdcaTitle(customerName, serviceLabel, standards);

const { projectRepo } = require('../repos/projectRepo');
const { customerRepo } = require('../repos/customerRepo');
const { reminderRepo } = require('../repos/reminderRepo');
const { knowledgeRepo } = require('../repos/knowledgeRepo');
const { settlementRepo } = require('../repos/settlementRepo');
/*
  2026-08-24 补：这个引入原来是缺的，而下面有两处 businessEventRepo.record()。
  后果是**完成项目走到最后一步必抛 ReferenceError**——
  前面的级联（客户 PDCA、提醒、结算）都已经写进去了，
  然后在记账本时崩掉，用户看到 500，但数据已经改了一半。

  是端到端测试跑成功路径时撞出来的：之前的测试只覆盖了被拒绝的分支。
  只测失败路径是不够的，成功路径才是每天都在走的那条。
*/
const { businessEventRepo } = require('../repos/businessEventRepo');

// 按 settlementConfig 计算结算金额（元）
const computeSettlementAmount = (project) => {
  const cfg = project.settlementConfig || {};
  const revenue = Number(project.projectAmount || 0);
  const gross = revenue - Number(project.purchasingCost || 0);
  if (cfg.rule === 'Fixed') return Number(cfg.value || 0);
  if (cfg.rule === 'ProfitShare') return Math.round(gross * Number(cfg.value || 0) / 100);
  return Math.round((cfg.base === 'GrossProfit' ? gross : revenue) * Number(cfg.value || 0) / 100); // Ratio
};

const KNOWLEDGE_MANAGEMENT_ROLES = ['ADMIN', 'MANAGER'];
const todayStr = () => new Date().toISOString().slice(0, 10);

// 读旧 state store 的合同（只读，用于费用门提示与 PDCA 上下文）；批次3 迁移后改读 PG。
const loadContracts = async () => {
  try {
    const { getStateBatch } = require('../stateStore');
    const state = await getStateBatch(['contracts_v8']);
    const arr = state?.datasets?.contracts_v8;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const resolvePDCAContext = (project, contract) => {
  const primary = (project.serviceItems || []).find((si) => si.standardName || si.name);
  const projectTypeLabel =
    primary?.standardName || primary?.name || contract?.serviceLine || contract?.title ||
    project.name || project.projectType || 'Self-Operated';
  const serviceCategory = primary?.category;
  const certCategories = ['体系认证', '产品认证', '生产许可类'];
  const isCertProject = Boolean(
    (serviceCategory && certCategories.includes(serviceCategory)) ||
    projectTypeLabel.includes('体系') || projectTypeLabel.includes('认证') ||
    (project.name || '').includes('体系') || (project.name || '').includes('认证') ||
    (project.contractRef || '').includes('CERT')
  );
  const nextOpportunity =
    serviceCategory === '政府项目申报' ? '政策窗口/复评'
    : serviceCategory === '管理培训/顾问服务' ? '续费/复训'
    : serviceCategory === '其他' ? '待评估'
    : (isCertProject ? '年审' : '待评估');
  return { projectTypeLabel, serviceCategory, nextOpportunity, isCertProject };
};

const buildPdcaKnowledgeDoc = ({ customer, contract, project, projectTypeLabel, nextOpportunity }) => {
  const nowStr = todayStr();
  const receivables = contract?.receivables || [];
  const paidCount = receivables.filter((r) => r.status === 'paid').length;
  const contractAmount = Number(contract?.amount || 0);
  const serviceItems = (project?.serviceItems || []).map((si) => si.standardName || si.name || si.rawName).filter(Boolean);
  const serviceLabel = serviceItems.join(' / ') || projectTypeLabel || contract?.serviceLine || contract?.title || project?.name || '未填写';
  const tasks = project?.tasks || [];
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'Completed').length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const taskLines = totalTasks > 0
    ? tasks.slice(0, 8).map((t) => `- ${t.title}（${t.status === 'Completed' ? '已完成' : '进行中'}，负责人：${t.owner || '待分配'}）`).join('\n')
    : '- 暂无任务流水（请补充）';
  const receivableLines = receivables.length > 0
    ? receivables.map((r) => `- ${r.node}：¥${Number(r.amount || 0).toLocaleString()}（${r.status === 'paid' ? '已回款' : '未回款'}）`).join('\n')
    : '- 暂无回款节点';
  const titleBase = contract?.title || project?.name || serviceLabel;

  const content = `# 客户复盘 (PDCA)

## 基本信息
- 客户：${customer.name}
- 项目/合同：${titleBase}
- 服务项：${serviceLabel}
- 合同金额：¥${contractAmount.toLocaleString()}
- 回款进度：${paidCount}/${receivables.length}

## P 计划
- 目标/范围：${serviceLabel}
- 负责人：${project?.manager || contract?.contactPerson || '待指派'}

## D 执行
- 任务完成率：${totalTasks > 0 ? `${taskCompletionRate}% (${completedTasks}/${totalTasks})` : '暂无任务记录'}
${taskLines}

## C 检查
- 质量/进度结论：请补充

## A 改进
- 下一次机会：${nextOpportunity || '待评估'}

## 回款明细
${receivableLines}
`;

  const standards = detectStandards(
    serviceLabel, contract?.serviceLine, contract?.title, project?.name, content);
  const tags = ['PDCA', '回款完成', serviceLabel, ...standards];
  if (contract?.id) tags.push(`contract:${contract.id}`);
  if (project?.id) tags.push(`project:${project.id}`);


  return {
    id: `DOC-PDCA-${Date.now()}`,
    title: buildPdcaTitle(customer.name, serviceLabel, standards),
    category: 'PDCA', format: 'Markdown', size: '2 KB', updatedAt: nowStr,
    content, summary: `回款已完成，系统自动生成 PDCA 复盘草稿（服务：${serviceLabel}）。`,
    aiVisible: true, source: 'system', autoGenerated: true,
    // 复盘是我们自己的经验，不是标准原文——AI 引用时要说明「据我们以往经验」
    trustLevel: 'ourExperience',
    standards,
    industry: customer.industry || '',
    linkType: 'customer', linkId: customer.id, linkTitle: customer.name, tags,
    accessRoles: KNOWLEDGE_MANAGEMENT_ROLES
  };
};

// 主入口。返回 { ok, eventId } 或 { ok:false, reason }
const completeProject = async (projectId, opts = {}) => {
  const project = await projectRepo.getById(projectId);
  if (!project) return { ok: false, reason: '项目不存在' };
  if (project.status === 'Completed') return { ok: false, reason: '项目已完成' };

  const contracts = await loadContracts();
  const nextTasks = Array.isArray(opts.tasksOverride) ? opts.tasksOverride : (project.tasks || []);
  const now = new Date();
  const nowStr = now.toISOString().split('T')[0];
  const eventId = `EVT-PCOMP-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const source = opts.source || 'manual';
  const isIntelFollowUp = project.projectMode === 'followup' && project.sourceType === 'intel';

  /*
    ── 完成项目前，未完成的任务必须有交代 ────────────────────────
    「不强制完成，但强制交代」：任务可以完成，也可以跳过（跳过必须填原因），
    但**不能就那么空着**。

    2026-08-24 在真实数据里查到，这个口子之前是敞开的：
      东莞市万豪包装  已完成 / 进度 100% / 6 个核心任务一个没勾
      平阳县新锦油茶  已完成 / 进度 100% / 5 个核心任务一个没勾
      温州宏宏食品    已完成 / 进度 100% / 3 个核心任务一个没勾
    因为下面直接写死了 progress: 100，根本不看任务状态。

    后果不是数字难看，是**项目管理失去意义**：进度永远是 100，
    延误率永远是 100%（那 70 个逾期任务就是这么来的），
    没有任何指标能告诉你哪个项目真的卡住了。

    前端有一个完成前检查清单，但那是提示，绕得过去。
    真正的闸门必须在服务端。
  */
  const unresolved = nextTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Skipped');
  if (unresolved.length > 0 && !opts.allowUnresolvedTasks) {
    return {
      ok: false,
      reason: `还有 ${unresolved.length} 个任务没有交代：${unresolved.slice(0, 5).map((t) => t.title).join('、')}`
        + (unresolved.length > 5 ? ` 等 ${unresolved.length} 个` : '')
        + '。请逐个标记完成，或选择跳过并填写原因。',
      unresolvedTasks: unresolved.map((t) => ({ id: t.id, title: t.title })),
    };
  }

  const totalTasks = nextTasks.length;
  const completedTasks = nextTasks.filter((t) => t.status === 'Completed').length;
  const delayedTasks = nextTasks.filter((t) => new Date(t.deadline) < now && t.status !== 'Completed').length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;
  const createdTs = Number(String(project.id).split('-')[1]);
  const createdAt = Number.isFinite(createdTs) ? new Date(createdTs) : now;
  const rawDuration = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24));
  const duration = rawDuration > 0 ? rawDuration : (project.duration || 1);

  /*
    进度按任务算出来，不写死 100。

    跳过的任务不计入分母——它们是「明确决定不做」，
    不该拉低进度，也不该被算成已完成来充数。
    全部任务都完成或跳过时，结果自然是 100。
  */
  const coreTasks = nextTasks.filter((t) => t.category === 'Core' && t.status !== 'Skipped');
  const finalProgress = coreTasks.length === 0
    ? 100
    : Math.round((coreTasks.filter((t) => t.status === 'Completed').length / coreTasks.length) * 100);

  // ---- 情报跟进项目：快速完成，跳过费用门，评级 A/B/C ----
  if (isIntelFollowUp) {
    const rating = delayedTasks === 0 ? 'A' : delayedTasks < 3 ? 'B' : 'C';
    await projectRepo.update(projectId, {
      status: 'Completed', progress: finalProgress, tasks: nextTasks,
      completionRecord: { eventId, completedAt: now.toISOString(), actualEndDate: nowStr, duration, passRate: delayedTasks === 0, taskCompletionRate, delayedTasksCount: delayedTasks, rating, autoCompleted: source === 'auto', customerId: project.customerId }
    });
    return { ok: true, eventId, mode: 'intel-followup' };
  }

  // ---- 费用关闭校验（T-001）----
  if (project.costStatus !== '已确认') {
    const linked = contracts.find((c) => c.id === project.contractRef || c.contractNo === project.contractRef);
    if ((linked?.receivables || []).length > 0) return { ok: false, reason: '❌ 已存在回款记录，请先补录项目合同金额并确认后再完结。' };
    return { ok: false, reason: '❌ 项目费用未确认，禁止完结！请先补全金额并确认。' };
  }
  if (!project.projectAmount || project.projectAmount <= 0) {
    return { ok: false, reason: '❌ 项目金额无效，禁止完结！' };
  }

  const rating = delayedTasks === 0 ? 'S' : delayedTasks < 3 ? 'A' : 'B';

  // ---- PDCA 绑定客户（查找或新建）----
  let targetCustomerId = project.customerId;
  let targetCustomer = targetCustomerId ? await customerRepo.getById(targetCustomerId) : null;
  let isNewCustomer = false;
  const ref = project.contractRef || '';

  /*
    从来源信息找客户。**优先读 sourceType/sourceRef，前缀只作旧数据兜底。**

    contractRef 以前被当成多态字段用：CT-xxx 是真实合同，
    LEAD:/INTEL:/CUST: 是来源前缀。同一份信息在两处表达，必然漂移——
    实测已出现前缀写 CUST 而 source_type 是 customer 这类对不上的记录。

    职责已分开：contractRef 只存真实合同 ID，来源统一走 sourceType/sourceRef。
    这里保留前缀解析是为了读旧数据，新写入不再产生前缀（见 convertSignal.js）。
  */
  const sourceType = String(project.sourceType || '').toLowerCase();
  const sourceRef = String(project.sourceRef || '').trim();
  const legacyPrefix = ref.match(/^(CUST|LEAD|INTEL):(.*)$/);
  const fromType = sourceType || (legacyPrefix ? legacyPrefix[1].toLowerCase().replace('cust', 'customer') : '');
  const fromRef = sourceRef || (legacyPrefix ? legacyPrefix[2] : '');

  if (!targetCustomer) {
    if (fromType === 'customer' && fromRef) {
      targetCustomerId = fromRef;
      targetCustomer = await customerRepo.getById(targetCustomerId);
    }
    if (!targetCustomer && fromType === 'lead') {
      // 线索来源：按公司名兜底（线索表在 PG，可扩展按 USCC 匹配）
      targetCustomer = await customerRepo.findByName(project.name);
    }
    if (!targetCustomer) {
      const linked = contracts.find((c) => c.id === ref);
      const possibleName = linked?.customerName || (project.name.includes(' ') ? project.name.split(' ')[0] : project.name);
      targetCustomer = await customerRepo.findByName(possibleName);
      if (!targetCustomer) {
        isNewCustomer = true;
        targetCustomerId = `C-AUTO-${Date.now()}`;
        targetCustomer = { id: targetCustomerId, name: possibleName, contactPerson: project.manager, totalValue: 0, riskStatus: 'low', activeContracts: 0, status: 'Active', cooperationCount: 0, serviceCount: 0 };
      }
    }
  }
  if (targetCustomer && !targetCustomerId) targetCustomerId = targetCustomer.id;

  const linkedContract = contracts.find((c) => c.id === project.contractRef || c.contractNo === project.contractRef) || null;
  const { projectTypeLabel, nextOpportunity, isCertProject } = resolvePDCAContext(project, linkedContract);

  // ---- 计算客户累计额/分级（元单位，阈值同原逻辑）----
  const completedForCustomer = (await projectRepo.list({ customerId: targetCustomerId, status: 'Completed' }))
    .filter((p) => p.costStatus === '已确认');
  const currentAmount = project.projectAmount || 0;
  const totalAmount = completedForCustomer.reduce((s, p) => s + (p.projectAmount || 0), 0) + currentAmount;
  const currentYear = new Date().getFullYear();
  const isCurrentYear = nowStr.startsWith(String(currentYear));
  const yearAmount = completedForCustomer
    .filter((p) => p.completionRecord?.actualEndDate?.startsWith(String(currentYear)))
    .reduce((s, p) => s + (p.projectAmount || 0), 0) + (isCurrentYear ? currentAmount : 0);
  const level = totalAmount >= 100000 ? 'A' : totalAmount >= 30000 ? 'B' : 'C';

  // ---- 生成提醒 ----
  const reminderIds = [];
  const remindersToAdd = [];
  if (isCertProject) {
    const certs = (targetCustomer.certificates || []).filter((c) => c.expiryDate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const expiryStr = certs[0]?.expiryDate || new Date(now.getTime() + 365 * 3 * 24 * 3600 * 1000).toISOString().split('T')[0];
    [90, 60, 30].forEach((days, idx) => {
      const remindDate = new Date(new Date(expiryStr).getTime() - days * 24 * 3600 * 1000);
      const id = `REM-${eventId}-EXP-${idx}`;
      reminderIds.push(id);
      remindersToAdd.push({ id, title: `客户【${targetCustomer.name}】证书到期提醒（剩余${days}天）`, content: `关联项目：${project.name}。建议提前跟进续证事宜。`, date: remindDate.toISOString().split('T')[0], type: 'expire', isRead: false, linkId: targetCustomerId, linkType: 'customer' });
    });
  } else {
    const id = `REM-${eventId}-UPSELL`;
    reminderIds.push(id);
    remindersToAdd.push({ id, title: `客户【${targetCustomer.name}】复购提示`, content: `关联项目：${project.name}。建议评估二次转化机会（当前推断机会：${nextOpportunity}）。`, date: new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString().split('T')[0], type: 'opportunity', isRead: false, linkId: targetCustomerId, linkType: 'customer' });
  }

  const customerPatch = {
    cooperationCount: (targetCustomer.cooperationCount || 0) + 1,
    serviceCount: (targetCustomer.serviceCount || 0) + 1,
    lastProjectAt: nowStr, lastProjectType: projectTypeLabel, nextOpportunity,
    lastServiceDate: nowStr, firstServiceDate: targetCustomer.firstServiceDate || nowStr,
    totalAmount, yearAmount, level, status: 'Active'
  };

  const pdcaDoc = buildPdcaKnowledgeDoc({ customer: targetCustomer, contract: linkedContract, project, projectTypeLabel, nextOpportunity });

  // 自动结算草稿（按 settlementConfig）
  const settlementAmount = computeSettlementAmount(project);
  const settlementDraft = settlementAmount > 0 ? {
    id: `S-AUTO-${eventId}`,
    type: project.projectType === 'Outsourced' ? 'External' : 'Internal',
    beneficiary: project.projectType === 'Outsourced' ? (project.vendorName || '供应商') : project.manager,
    contractRef: project.name,
    month: nowStr.slice(0, 7),
    amount: settlementAmount,
    status: 'draft',
    notes: '项目完成自动生成',
  } : null;

  // ---- 单事务执行所有写入 ----
  await withTransaction(async (client) => {
    const run = (t, v) => client.query(t, v);
    if (isNewCustomer) {
      await customerRepo.createWith(run, { ...targetCustomer, ...customerPatch });
    } else {
      await customerRepo.updateWith(run, targetCustomerId, customerPatch);
    }
    for (const rem of remindersToAdd) await reminderRepo.createWith(run, rem);
    await knowledgeRepo.createWith(run, pdcaDoc);
    if (settlementDraft) await settlementRepo.createWith(run, settlementDraft);
    await projectRepo.updateWith(run, projectId, {
      status: 'Completed', progress: finalProgress, customerId: targetCustomerId, tasks: nextTasks,
      completionRecord: { eventId, completedAt: now.toISOString(), actualEndDate: nowStr, duration, passRate: true, taskCompletionRate, delayedTasksCount: delayedTasks, rating, autoCompleted: source === 'auto', customerId: targetCustomerId, generatedReminderIds: reminderIds }
    });
  });

  /*
    写 Action Ledger。项目完结是全系统级联最多的动作——
    改项目状态、生成完成记录、更新客户分级、生成 PDCA、生成结算草稿、发提醒，
    六件事一次做完。不记的话，事后想查「这单为什么给了这个评级 / 提成怎么算出来的」
    只能靠翻各张表的 updated_at 拼时间线。
  */
  await businessEventRepo.record({
    eventType: 'project.completed',
    subjectType: 'project',
    subjectId: projectId,
    actorUserId: opts.actor?.id || '',
    actorName: opts.actor?.name || '',
    viaAiAgent: Boolean(opts.actor?.viaAiAgent),
    onBehalfOf: opts.actor?.onBehalfOf || null,
    summary: `完结项目「${project.name}」评级 ${rating}`,
    reason: opts.reason || (source === 'auto' ? '系统自动完结' : null),
    policy: opts.actor?.policy || null,
    aiLevel: opts.actor?.aiLevel || null,
    result: 'success',
    detail: {
      before: { status: project.status, progress: project.progress },
      after: { status: 'Completed', progress: finalProgress },
      source,
      rating,
      duration,
      taskCompletionRate,
      delayedTasksCount: delayedTasks,
      // 级联产物：出问题时按这些 id 能一路查回去
      cascade: {
        customerId: targetCustomerId,
        customerLevel: level,
        pdcaDocId: pdcaDoc.id,
        settlementId: settlementDraft?.id || null,
        settlementAmountFen: settlementDraft?.amount || 0,
        reminderIds,
      },
    },
  });

  // 结算是钱的事，单独记一条——查提成时不必翻项目完结事件的 detail
  if (settlementDraft) {
    await businessEventRepo.record({
      eventType: 'settlement.created',
      subjectType: 'settlement',
      subjectId: settlementDraft.id,
      actorUserId: opts.actor?.id || '',
      actorName: opts.actor?.name || '',
      viaAiAgent: Boolean(opts.actor?.viaAiAgent),
      onBehalfOf: opts.actor?.onBehalfOf || null,
      summary: `生成结算草稿 ${settlementDraft.beneficiary} ¥${(Number(settlementDraft.amount || 0) / 100).toLocaleString()}`,
      reason: '项目完结自动生成',
      result: 'success',
      detail: {
        after: settlementDraft,
        projectId,
        rule: project.settlementConfig || null,
      },
    });
  }

  return { ok: true, eventId, customerId: targetCustomerId, rating, level, reminderIds, pdcaDocId: pdcaDoc.id };
};

module.exports = { completeProject, buildPdcaKnowledgeDoc, resolvePDCAContext, loadContracts, todayStr };
