// 批次1 路由：线索 + 客户 CRM，基于 PG 新表。
// DB（XINYI_DB_URL）未启用时全部 next() 落回 app.js 旧逻辑，保证现有环境不受影响。
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { leadRepo } = require('../repos/leadRepo');
const { customerRepo } = require('../repos/customerRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { requireAction } = require('../authz/middleware');
const { refreshMirror } = require('../services/datasetMirror');
const { claimPatch, recordOwnershipChange, resourceOf, makeAssignOwnerRoute } = require('../authz/ownership');

/*
  线索资源解析器：必须**把库里那条记录捞出来**给授权层看归属。
  之前这里只传 { type, id }，授权层看不到 ownerUserId，
  等于每条线索在判定时都长得一样——既分不出「是不是我的」，
  也分不出「有没有主」。归属判定形同虚设。
  不能拿请求体里的 ownerUserId 顶替：调用方自己传一个就绕过去了。
*/
const leadResource = async (req) => resourceOf('lead', (await leadRepo.getById(req.params?.id)) || {});
const customerResource = async (req) => resourceOf('customer', (await customerRepo.getById(req.params?.id)) || {});

/** 认领落库 + 记账本。跟进和编辑两条路都要走，抽出来避免只改一处 */
const applyClaim = async (req, leadId) => {
  const claim = claimPatch(req.authzDecision, req.authUser);
  if (!Object.keys(claim).length) return false;
  await leadRepo.update(leadId, claim);
  await recordOwnershipChange({
    kind: 'claim', resourceType: 'lead', resourceId: leadId,
    actor: { ...req.authUser, viaAiAgent: Boolean(req.aiActor) },
    toUserId: req.authUser?.id, toName: req.authUser?.name,
    policy: req.authzDecision?.policy, reason: req.authzDecision?.reason,
  });
  return true;
};

const router = express.Router();

const today = () => new Date().toISOString().slice(0, 10);
const makeId = (p) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// DB 未启用 → 跳过整个 router，落回 app.js 旧逻辑
router.use((req, res, next) => {
  if (!pool.isEnabled()) return next('router');
  return next();
});

const MIRROR_TARGETS = [
  ['lead', leadRepo, /^\/api\/leads(\/|$)/],
  ['customer', customerRepo, /^\/api\/customers(\/|$)/],
];

/*
  写请求成功后刷新 state store 里的数据集镜像。

  前端进页面时先用镜像水合，保存时又把整份数据集写回镜像——
  如果 API（比如网站表单进线索）只写了 PG，前端手里的旧镜像一保存就把它盖掉了。
  实测证据：state store 458 条线索 vs PG 455 条。详见 services/datasetMirror.js。

  挂在最前面用 res.on('finish')，这样不用逐条路由改，
  新增写接口也自动被覆盖——靠人记得在每个 handler 里调一次，迟早会漏。
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

const getLeadPayload = (body = {}) => (body?.lead && typeof body.lead === 'object' ? body.lead : (body || {}));
const getCustomerPayload = (body = {}) => (body?.customer && typeof body.customer === 'object' ? body.customer : (body || {}));

/*
  没传 contacts 时，用姓名/手机/微信/职务生成一个主联系人。

  2026-08-21 修：这里原来无条件写 contacts: []，而 app.js 那条回退路径
  会自动建主联系人。生产走的是本文件（PG 启用），于是销售录进去的手机和微信
  **不会出现在联系人列表里**——字段存下来了，但界面上取的是 contacts。
  两套实现各写一份规范化逻辑，漂移是迟早的事，这次漂在了线索的联系方式上。
*/
const primaryContactOf = (raw = {}) => {
  if (Array.isArray(raw.contacts)) return raw.contacts;
  const has = ['name', 'mobile', 'wechat', 'position'].some((k) => String(raw[k] || '').trim());
  if (!has) return [];
  return [{
    id: makeId('CT'),
    name: String(raw.name || '').trim(),
    mobile: String(raw.mobile || '').trim(),
    wechat: String(raw.wechat || '').trim(),
    position: String(raw.position || '').trim(),
    isPrimary: true,
  }];
};

const normLeadCreate = (raw = {}) => ({
  status: 'New', score: 60, probability: 20, intent: 'Medium', source: '官网',
  lastContact: today(), followUpRecords: [],
  ...raw,
  contacts: primaryContactOf(raw),
  ownerUserId: raw.ownerUserId || ''
});

const normFollowUp = (raw = {}) => ({
  id: raw.id || makeId('F'),
  date: raw.date || today(),
  type: raw.type || 'call',
  content: String(raw.content || ''),
  operator: raw.operator || '系统'
});

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch1 error', {}, 500); }
};

// ---- 线索 ----
router.get('/api/leads', wrap(async (req, res) => {
  const leads = await leadRepo.list({ status: req.query.status, ownerUserId: req.query.owner, q: req.query.q });
  sendSuccess(res, { leads }, 'success');
}));

router.get('/api/leads/:id', wrap(async (req, res) => {
  const lead = await leadRepo.getById(req.params.id);
  if (!lead) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Lead not found', {}, 404);
  sendSuccess(res, { lead }, 'success');
}));

router.post('/api/leads',
  requireAction('LEAD_CREATE', { resource: (req) => ({ type: 'lead', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const lead = await leadRepo.create(normLeadCreate(getLeadPayload(req.body)));
  sendSuccess(res, { lead }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 改线索用 LEAD_EDIT，不是 LEAD_CREATE——用建线索的码管修改行为，
// 等于任何能新建线索的人都能改别人的线索。
router.patch('/api/leads/:id',
  requireAction('LEAD_EDIT', { resource: leadResource }),
  wrap(async (req, res) => {
  const exists = await leadRepo.getById(req.params.id);
  if (!exists) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Lead not found', {}, 404);
  await leadRepo.update(req.params.id, getLeadPayload(req.body));
  const claimed = await applyClaim(req, req.params.id);
  const lead = await leadRepo.getById(req.params.id);
  sendSuccess(res, { lead, claimed }, 'success');
}));

// 跟进是「谁跟进谁认领」最自然的落点：销售打完电话记一条，线索就归他了。
// 不需要额外的「认领」按钮——多一个按钮就多一步没人愿意做的操作。
router.post('/api/leads/:id/follow-ups',
  requireAction('LEAD_EDIT', { resource: leadResource }),
  wrap(async (req, res) => {
  const record = normFollowUp(req.body?.record || req.body);
  const lead = await leadRepo.addFollowUp(req.params.id, record);
  if (!lead) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Lead not found', {}, 404);
  const claimed = await applyClaim(req, req.params.id);
  sendSuccess(res, { lead: claimed ? await leadRepo.getById(req.params.id) : lead, record, claimed },
    'success', ERROR_CODES.SUCCESS, 201);
}));

// 线索 → 客户（级联，依据 phase0-inventory §7.2）
router.post('/api/leads/:id/convert',
  requireAction('LEAD_CONVERT', { resource: leadResource }),
  wrap(async (req, res) => {
  const lead = await leadRepo.getById(req.params.id);
  if (!lead) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Lead not found', {}, 404);

  // 查重：统一信用代码 → 公司名
  let customer = await customerRepo.findByUscc(lead.unifiedSocialCreditCode);
  if (!customer) customer = await customerRepo.findByName(lead.company);
  let created = false;

  if (!customer) {
    customer = await customerRepo.create({
      name: lead.company,
      contactPerson: lead.name,
      mobile: lead.mobile,
      industry: lead.industry,
      unifiedSocialCreditCode: lead.unifiedSocialCreditCode,
      registeredAddress: lead.registeredAddress,
      registeredCapital: lead.registeredCapital,
      businessScope: lead.businessScope,
      legalRepresentative: lead.legalRepresentative,
      totalValue: 0, riskStatus: 'low', activeContracts: 0,
      status: 'Active', cooperationCount: 0, serviceCount: 0,
      contacts: lead.contacts || []
    });
    created = true;
  }

  const updatedLead = await leadRepo.update(lead.id, { status: 'Converted' });
  sendSuccess(res, { lead: updatedLead, customer, created }, 'success');
}));

// ---- 客户 ----
router.get('/api/customers', wrap(async (req, res) => {
  const customers = await customerRepo.list({ level: req.query.level, riskStatus: req.query.riskStatus, q: req.query.q });
  sendSuccess(res, { customers }, 'success');
}));

router.get('/api/customers/:id', wrap(async (req, res) => {
  const customer = await customerRepo.getById(req.params.id);
  if (!customer) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Customer not found', {}, 404);
  sendSuccess(res, { customer }, 'success');
}));

router.post('/api/customers',
  requireAction('CUSTOMER_CREATE', { resource: (req) => ({ type: 'customer', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const raw = getCustomerPayload(req.body);
  const customer = await customerRepo.create({
    riskStatus: 'low', status: 'Active', activeContracts: 0,
    cooperationCount: 0, serviceCount: 0, contacts: [], followUpRecords: [],
    ...raw
  });
  sendSuccess(res, { customer }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 改客户用 CUSTOMER_EDIT，不是 CUSTOMER_CREATE。
// 用「建」的码去管「改」的行为，等于任何能建客户的人都能改别人的客户——
// 线索那边刚踩过同一个坑（见上面 /api/leads/:id 的注释）。
router.patch('/api/customers/:id',
  requireAction('CUSTOMER_EDIT', { resource: customerResource }),
  wrap(async (req, res) => {
  const exists = await customerRepo.getById(req.params.id);
  if (!exists) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Customer not found', {}, 404);
  const customer = await customerRepo.update(req.params.id, getCustomerPayload(req.body));
  sendSuccess(res, { customer }, 'success');
}));

router.post('/api/customers/:id/follow-ups',
  requireAction('CUSTOMER_EDIT', { resource: customerResource }),
  wrap(async (req, res) => {
  const record = normFollowUp(req.body?.record || req.body);
  const customer = await customerRepo.addFollowUp(req.params.id, record);
  if (!customer) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Customer not found', {}, 404);
  sendSuccess(res, { customer, record }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 批量导入线索（Excel 导入用）。逐条 upsert，幂等；导入几百条时避免前端发几百个请求。
router.post('/api/leads/bulk',
  requireAction('LEAD_CREATE', { resource: (req) => ({ type: 'lead', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const list = Array.isArray(req.body?.leads) ? req.body.leads : [];
  const written = await leadRepo.bulkUpsert(list);
  sendSuccess(res, { written }, 'success', ERROR_CODES.SUCCESS, 201);
}));


/*
  指派负责人。与线索认领相对的另一条路：合同和项目牵扯金额与交付责任，
  不能自认领，必须由有指派权的人显式指定（见 constants.ts 的角色配置）。
  路由必须挂在这里、和业务数据用同一个 repo——写在 app.js 里读 state store
  会指到另一个存储上，永远 404。
*/
makeAssignOwnerRoute({
  router, path: '/api/leads/:id/owner', action: 'LEAD_ASSIGN_OWNER',
  resourceType: 'lead', repo: leadRepo, requireAction,
});


module.exports = router;
