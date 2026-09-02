// 批次3 路由：合同 + 结算（PG 新表）+ 回款确认级联。
// DB 未启用 → next('router') 落回 app.js 旧逻辑。
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { contractRepo } = require('../repos/contractRepo');
const { settlementRepo } = require('../repos/settlementRepo');
const { confirmReceivable } = require('../services/confirmReceivable');
const { upsertDatasets, extractDatasets } = require('../services/txUpsert');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { requireAction } = require('../authz/middleware');
const { refreshMirror, refreshMirrorsByKeys } = require('../services/datasetMirror');
const { makeAssignOwnerRoute, resourceOf } = require('../authz/ownership');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const MIRROR_TARGETS = [
  ['contract', contractRepo, /^\/api\/contracts(\/|$)/],
];

/*
  写请求成功后刷新 state store 里的数据集镜像。
  前端进页面时先用镜像水合，保存时又把整份数据集写回镜像——
  API 只写 PG 的话，前端手里的旧镜像一保存就把新数据盖掉。
  详见 services/datasetMirror.js。用 res.on('finish') 统一挂，
  不逐条路由改：靠人记得在每个 handler 里调一次，迟早会漏。
*/
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const hit = MIRROR_TARGETS.find(([, , re]) => re.test(req.path));
  if (!hit) return next();

  /*
    在**响应发出之前**刷完镜像，不能挂 res.on('finish')。
    finish 是响应已经发走之后才触发的，调用方（以及测试）紧接着读
    /api/state/sync 会读到还没刷新的旧镜像——一个时好时坏的竞态。
    这里代价是每次写多等一次全量回写，按信义的数据量（几百条）可以接受。
  */
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) return origJson(body);
    return refreshMirror(hit[0], hit[1], { actorUserId: req.authUser?.id || '' })
      .then(() => origJson(body))
      .catch(() => origJson(body));
  };
  return next();
});


const makeId = (p) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);

/*
  资源解析器：**必须把库里那条记录捞出来**给授权层看归属。

  之前这里只传 { type, id }，授权层看不到 ownerUserId / manager，
  于是每条记录在判定时都长得一样——既分不出「是不是我的」，也分不出「有没有主」。
  2026-08-22 的 enforce 演练里这个坑现形了：项目明明已经指派给某个顾问，
  他去建任务却被拦下，提示「这条数据还没有指派负责人」。
  现在 authorize() 对拿不到 id 的非新建动作会直接拒绝并报配置问题，不再默默放行。
*/
const contractResource = async (req) => resourceOf('contract', (await contractRepo.getById(req.params?.id)) || {});

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch3 error', {}, 500); }
};
const getContractPayload = (b = {}) => (b?.contract && typeof b.contract === 'object' ? b.contract : (b || {}));

// ---- 合同 ----
router.get('/api/contracts', wrap(async (req, res) => {
  const contracts = await contractRepo.list({ customerId: req.query.customerId, status: req.query.status });
  sendSuccess(res, { contracts }, 'success');
}));

router.get('/api/contracts/:id', wrap(async (req, res) => {
  const contract = await contractRepo.getById(req.params.id);
  if (!contract) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Contract not found', {}, 404);
  sendSuccess(res, { contract }, 'success');
}));

router.post('/api/contracts',
  requireAction('CONTRACT_CREATE', { resource: contractResource }),
  wrap(async (req, res) => {
  const raw = getContractPayload(req.body);
  const contract = await contractRepo.create({
    status: 'Active', archiveStatus: 'active', riskLevel: 'Low',
    signDate: today(), receivables: [], attachments: [], serviceItems: [],
    ...raw,
  });
  sendSuccess(res, { contract }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 改合同用 CONTRACT_EDIT，不是 CONTRACT_CREATE——同线索、客户那两处一样的理由
router.patch('/api/contracts/:id',
  requireAction('CONTRACT_EDIT', { resource: contractResource }),
  wrap(async (req, res) => {
  const exists = await contractRepo.getById(req.params.id);
  if (!exists) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Contract not found', {}, 404);
  const contract = await contractRepo.update(req.params.id, getContractPayload(req.body));

  /*
    金额变动单独记一条 Ledger。合同修改可能只是改个联系人，
    但**金额改动必须能追溯**——它直接决定回款、提成和统计口径。
    只在金额真的变了时才记，避免把无关的字段改动也刷进账本。
  */
  if (contract && Number(exists.amount) !== Number(contract.amount)) {
    const yuan = (fen) => `¥${(Number(fen || 0) / 100).toLocaleString()}`;
    await businessEventRepo.record({
      eventType: 'contract.amount_changed',
      subjectType: 'contract',
      subjectId: contract.id,
      actorUserId: req.authUser?.id || '',
      actorName: req.authUser?.name || '',
      viaAiAgent: Boolean(req.aiActor),
      onBehalfOf: req.aiActor ? (req.authUser?.id || '') : null,
      summary: `合同金额 ${yuan(exists.amount)} → ${yuan(contract.amount)}｜${contract.customerName || contract.id}`,
      reason: req.body?.reason || null,
      result: 'success',
      detail: {
        before: { amountFen: Number(exists.amount) || 0 },
        after: { amountFen: Number(contract.amount) || 0 },
        deltaFen: (Number(contract.amount) || 0) - (Number(exists.amount) || 0),
      },
    });
  }

  sendSuccess(res, { contract }, 'success');
}));

router.post('/api/contracts/:id/attachments',
  requireAction('CONTRACT_EDIT', { resource: contractResource }),
  wrap(async (req, res) => {
  const a = req.body?.attachment || req.body || {};
  const attachment = {
    id: a.id || makeId('ATT'), name: String(a.name || ''), size: a.size || '',
    type: a.type || '', uploadDate: a.uploadDate || today(), ...(a.url ? { url: a.url } : {}),
  };
  const contract = await contractRepo.addAttachment(req.params.id, attachment);
  if (!contract) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Contract not found', {}, 404);
  sendSuccess(res, { contract, attachment }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 回款确认（级联：项目 paymentStatus + 全额时客户分级/PDCA）
router.post('/api/contracts/:id/receivables/:rid/confirm',
  // 金额门槛要真金额才判得了：这里去查这一笔回款节点的实际金额（元→分）。
  // 不查的话金额三档（1万/5万）永远不会触发，等于没设。
  requireAction('PAYMENT_CONFIRM', {
    resource: async (req) => {
      const c = await contractRepo.getById(req.params.id);
      const r = (c?.receivables || []).find((x) => x.id === req.params.rid);
      return {
        type: 'contract', id: req.params.id,
        ownerUserId: c?.ownerUserId, customerId: c?.customerId,
        amountFen: Math.round(Number(r?.amount || 0) * 100),
      };
    },
    amountFen: async (req) => {
      const c = await contractRepo.getById(req.params.id);
      const r = (c?.receivables || []).find((x) => x.id === req.params.rid);
      return Math.round(Number(r?.amount || 0) * 100);
    },
  }),
  wrap(async (req, res) => {
  // 金额动作必须能追溯到人：把操作人传进服务层写 Ledger。
  // req.authUser 在 AI 代表执行时已被换成被代表人，req.aiActor 是 AI 服务账号本身
  const result = await confirmReceivable(req.params.id, req.params.rid, {
    id: req.authUser?.id || '',
    name: req.authUser?.name || '',
    viaAiAgent: Boolean(req.aiActor),
    onBehalfOf: req.aiActor ? (req.authUser?.id || '') : null,
    reason: req.body?.reason || null,
  });
  if (!result.ok) return sendFail(res, ERROR_CODES.DATA_CONFLICT, result.reason, {}, 409);
  const contract = await contractRepo.getById(req.params.id);
  sendSuccess(res, { ...result, contract }, 'success');
}));

// 前端批量事务写 → 落 PG（替代 legacy state_store）
// 同项目事务接口：目标合同在请求体里，不在路径参数里
router.post('/api/contracts/transaction',
  requireAction('CONTRACT_CREATE', {
    resource: async (req) => resourceOf('contract',
      (await contractRepo.getById(String(req.body?.contractId || ''))) || {}),
  }),
  wrap(async (req, res) => {
  const datasets = extractDatasets(req.body);

  /*
    入参校验，与 /api/projects/transaction 同一套理由：
    缺 contracts_v8、或 contractId 不在这批数据里，都必须明确 400。
    返回 200 但什么都没写，是事务接口最坏的一种行为——
    调用方以为成功了，不会重试，也不会告警。
  */
  if (!Array.isArray(datasets.contracts_v8)) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'contracts_v8 array is required', {}, 400);
  }
  const cid = String(req.body?.contractId || '').trim();
  const inPayload = cid ? datasets.contracts_v8.find((x) => String(x?.id || '') === cid) : null;
  if (cid && !inPayload) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'contractId not found in contracts_v8', {}, 400);
  }

  const result = await upsertDatasets(datasets);
  await refreshMirrorsByKeys(result.keys, {
    contract: contractRepo,
    customer: require('../repos/customerRepo').customerRepo,
    lead: require('../repos/leadRepo').leadRepo,
    project: require('../repos/projectRepo').projectRepo,
    reminder: require('../repos/reminderRepo').reminderRepo,
    settlement: settlementRepo,
  }, { actorUserId: req.authUser?.id || '' });
  const contract = cid ? await contractRepo.getById(cid) : null;
  sendSuccess(res, { written: result.written, keys: result.keys, contract }, 'success');
}));

// ---- 结算 ----
router.get('/api/settlements', wrap(async (req, res) => {
  const settlements = await settlementRepo.list({ contractRef: req.query.contractRef, month: req.query.month, status: req.query.status });
  sendSuccess(res, { settlements }, 'success');
}));

router.patch('/api/settlements/:id',
  requireAction('SETTLEMENT_MANAGE', {
    resource: async (req) => ({ type: 'settlement', ...((await settlementRepo.getById(req.params?.id)) || {}) }),
  }),
  wrap(async (req, res) => {
  const raw = req.body?.settlement || req.body || {};
  const settlement = await settlementRepo.update(req.params.id, raw);
  if (!settlement) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Settlement not found', {}, 404);
  sendSuccess(res, { settlement }, 'success');
}));

// 批量写结算：没有单一目标记录，按新建处理（财务的 writeScope 本就是 ALL）
router.post('/api/settlements/bulk',
  requireAction('SETTLEMENT_MANAGE', { creating: true, resource: () => ({ type: 'settlement' }) }),
  wrap(async (req, res) => {
  const list = Array.isArray(req.body?.settlements) ? req.body.settlements : [];
  let written = 0;
  for (const s of list) { if (!s) continue; await settlementRepo.upsertWith((t, v) => pool.query(t, v), s); written += 1; }
  sendSuccess(res, { written }, 'success');
}));

router.post('/api/settlements',
  requireAction('SETTLEMENT_MANAGE', { creating: true, resource: () => ({ type: 'settlement' }) }),
  wrap(async (req, res) => {
  const raw = req.body?.settlement || req.body || {};
  const settlement = await settlementRepo.create({ status: 'draft', month: today().slice(0, 7), ...raw });
  sendSuccess(res, { settlement }, 'success', ERROR_CODES.SUCCESS, 201);
}));


/*
  指派负责人。与线索认领相对的另一条路：合同和项目牵扯金额与交付责任，
  不能自认领，必须由有指派权的人显式指定（见 constants.ts 的角色配置）。
  路由必须挂在这里、和业务数据用同一个 repo——写在 app.js 里读 state store
  会指到另一个存储上，永远 404。
*/
makeAssignOwnerRoute({
  router, path: '/api/contracts/:id/owner', action: 'CONTRACT_ASSIGN_OWNER',
  resourceType: 'contract', repo: contractRepo, requireAction,
});


module.exports = router;
