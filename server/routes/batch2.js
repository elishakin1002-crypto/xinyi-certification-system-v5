// 批次2 路由：项目交付（PG 新表）+ 完成级联。
// DB 未启用 → next('router') 落回 app.js 旧逻辑。
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { projectRepo } = require('../repos/projectRepo');
const { customerRepo } = require('../repos/customerRepo');
const { completeProject } = require('../services/completeProject');
const { upsertDatasets, extractDatasets } = require('../services/txUpsert');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { explainDbError } = require('../utils/dbErrors');
const { requireAction } = require('../authz/middleware');
const { refreshMirror, refreshMirrorsByKeys } = require('../services/datasetMirror');
const { makeAssignOwnerRoute, resourceOf } = require('../authz/ownership');
const { PROJECT_STATUS } = require('../../src/constants/status.js');

const router = express.Router();

/*
  项目状态必须是枚举里的词，不许调用方自带。

  2026-09-17 造验收样本时 `POST /api/projects` 传了 `status: '进行中'`，
  **原样存进了库**。后果不是报错，是更糟的东西：
    · 列表里照常显示（列表不按状态过滤）
    · 但项目管理四张卡每一张都判 `status !== 'Active'`，
      于是这个项目对四张卡**全部不可见**
    · 状态列渲染出原始字符串「进行中」，和旁边真项目的「执行中」并排，
      同一列两个词，谁也说不清差在哪
  也就是说：一个存在、能点开、却不进任何统计的项目。
  这正是 2026-09-15 那个「任务状态被静默改回待处理」的同款
  —— 服务端不校验枚举，前端按枚举算数。

  只认 Active/Completed：这两个是项目真正会有的态。
  其余（New/Pending/Converted/Risk/Lost）属于线索/合同，
  写到项目上就是脏数据。**不认识的一律拒绝，不静默改写** ——
  静默改写会让调用方以为自己传对了。
*/
const PROJECT_STATUS_VALUES = Object.values(PROJECT_STATUS);
const rejectBadProjectStatus = (status, res) => {
  if (status === undefined || status === null) return false;
  if (PROJECT_STATUS_VALUES.includes(status)) return false;
  sendFail(
    res,
    ERROR_CODES.PARAM_ERROR,
    `项目状态只能是 ${PROJECT_STATUS_VALUES.join(' 或 ')}，收到的是「${String(status).slice(0, 40)}」。`
      + '写进去的话，项目在列表里看得见，却不会出现在任何一张统计卡里。',
    {},
    400
  );
  return true;
};
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const MIRROR_TARGETS = [
  ['project', projectRepo, /^\/api\/projects(\/|$)/],
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

/*
  资源解析器：**必须把库里那条记录捞出来**给授权层看归属。

  之前这里只传 { type, id }，授权层看不到 ownerUserId / manager，
  于是每条记录在判定时都长得一样——既分不出「是不是我的」，也分不出「有没有主」。
  2026-08-22 的 enforce 演练里这个坑现形了：项目明明已经指派给某个顾问，
  他去建任务却被拦下，提示「这条数据还没有指派负责人」。
  现在 authorize() 对拿不到 id 的非新建动作会直接拒绝并报配置问题，不再默默放行。
*/
const projectResource = async (req) => resourceOf('project', (await projectRepo.getById(req.params?.id)) || {});

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    /*
      数据库约束报错要翻成人话，不能一律 500。
      500 在界面上等于「系统崩了」，同事只会截图来问；
      而真相往往是一句话能说清的（「这个客户不存在，先去建一下」）。
      认不出来的才走原来的 500 —— 见 server/utils/dbErrors.js。
    */
    const known = explainDbError(e);
    if (known) return sendFail(res, ERROR_CODES.PARAM_ERROR, known.message, {}, known.status);
    sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch2 error', {}, 500);
  }
};
const getProjectPayload = (body = {}) => (body?.project && typeof body.project === 'object' ? body.project : (body || {}));

// 任务规范化：补 id 和默认字段
const normTask = (t = {}) => ({
  id: t.id || makeId('T'),
  title: String(t.title || ''),
  deadline: t.deadline || '',
  status: t.status === 'Completed' ? 'Completed' : 'Pending',
  priority: t.priority || 'Medium',
  category: t.category || 'Core',
  owner: t.owner || '待指派',
  ...(t.serviceItemId ? { serviceItemId: t.serviceItemId } : {}),
});

// 进度 = 核心任务完成率（忠实移植 calculateProjectProgress）
const calcProgress = (tasks = []) => {
  if (!tasks.length) return 0;
  const core = tasks.filter((t) => t.category === 'Core');
  if (!core.length) return 0;
  const done = core.filter((t) => t.status === 'Completed').length;
  return Math.round((done / core.length) * 100);
};

router.get('/api/projects', wrap(async (req, res) => {
  const projects = await projectRepo.list({ status: req.query.status, manager: req.query.manager, customerId: req.query.customerId });
  sendSuccess(res, { projects }, 'success');
}));

router.get('/api/projects/:id', wrap(async (req, res) => {
  const project = await projectRepo.getById(req.params.id);
  if (!project) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Project not found', {}, 404);
  sendSuccess(res, { project }, 'success');
}));

router.post('/api/projects',
  requireAction('PROJECT_CREATE', { resource: projectResource }),
  wrap(async (req, res) => {
  const raw = getProjectPayload(req.body);
  /*
    必填校验 —— 2026-09-11 补。空请求体原来返回 500。

    500 和 400 是两件事：400 是「你传的不对」，500 是「服务端自己崩了」，
    后者意味着未捕获异常，可能已经写了半截数据。

    只校验名字。**不校验负责人** —— 我第一版加了，结果打挂 5 条测试：
    接口契约本来就允许「先建项目、再指派负责人」
    （POST /api/projects 不带 manager → PATCH /api/projects/:id/owner），
    那是个合法流程。前端表单要求填负责人是**前端的策略**，
    不能拿它去收紧接口契约 —— 那会打断别的调用方。

    教训：补校验时先看**现有测试和调用方在怎么用这个接口**，
    别照着前端表单的要求去加。我这次差一点把一个正常流程封死。
  */
  if (!String(raw?.name || '').trim()) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, '项目名称不能为空 —— 列表里会是一行空白，谁也认不出这是什么活。', {}, 400);
  }
  if (rejectBadProjectStatus(raw.status, res)) return undefined;
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map(normTask);
  const project = await projectRepo.create({
    status: 'Active', projectCategory: 'Delivery', projectType: 'Self-Operated',
    paymentStatus: 'unpaid', serviceItems: [], settlementConfig: { rule: 'Ratio', value: 0 },
    ...raw, tasks, progress: calcProgress(tasks),
  });
  sendSuccess(res, { project }, 'success', ERROR_CODES.SUCCESS, 201);
}));

// 仅非级联字段更新；禁止用此接口把 status 改成 Completed（必须走 /complete）
router.patch('/api/projects/:id',
  requireAction('PROJECT_EDIT_INFO', { resource: projectResource }),
  wrap(async (req, res) => {
  const exists = await projectRepo.getById(req.params.id);
  if (!exists) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Project not found', {}, 404);
  const updates = getProjectPayload(req.body);
  if (updates.status === 'Completed') {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, '完成项目请调用 /api/projects/:id/complete（含级联）', {}, 400);
  }
  // 建的时候拦了，改的时候也得拦 —— 否则绕一步 PATCH 就把脏状态写回去了
  if (rejectBadProjectStatus(updates.status, res)) return undefined;
  if (Array.isArray(updates.tasks)) updates.progress = calcProgress(updates.tasks);
  const project = await projectRepo.update(req.params.id, updates);
  sendSuccess(res, { project }, 'success');
}));

router.post('/api/projects/:id/tasks',
  requireAction('TASK_CREATE', { resource: projectResource }),
  wrap(async (req, res) => {
  const project = await projectRepo.getById(req.params.id);
  if (!project) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Project not found', {}, 404);
  const task = normTask(req.body?.task || req.body || {});
  const tasks = [...(project.tasks || []), task];
  const updated = await projectRepo.update(req.params.id, { tasks, progress: calcProgress(tasks) });
  sendSuccess(res, { project: updated, task }, 'success', ERROR_CODES.SUCCESS, 201);
}));

router.patch('/api/projects/:id/tasks/:taskId',
  requireAction('TASK_COMPLETE', { resource: projectResource }),
  wrap(async (req, res) => {
  const project = await projectRepo.getById(req.params.id);
  if (!project) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Project not found', {}, 404);
  const patch = req.body?.task || req.body || {};
  let found = false;
  const tasks = (project.tasks || []).map((t) => {
    if (t.id !== req.params.taskId) return t;
    found = true;
    return { ...t, ...patch, id: t.id };
  });
  if (!found) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Task not found', {}, 404);
  const updated = await projectRepo.update(req.params.id, { tasks, progress: calcProgress(tasks) });
  // 一并返回更新后的那条任务：app.js 的回退实现是这么返回的，
  // 这里漏了会让两条路径的响应形状不一致（调用方按哪个写都可能踩空）。
  const task = (updated.tasks || []).find((t) => t.id === req.params.taskId) || null;
  sendSuccess(res, { project: updated, task }, 'success');
}));

// 前端批量事务写 → 落 PG（替代 legacy state_store）
// 事务接口没有 :id，目标项目在请求体里。
// 不能沿用按 params 取的解析器——取不到就会被「拿不到目标记录」那道防线拒绝。
router.post('/api/projects/transaction',
  requireAction('PROJECT_EDIT_INFO', {
    resource: async (req) => resourceOf('project',
      (await projectRepo.getById(String(req.body?.projectId || ''))) || {}),
  }),
  wrap(async (req, res) => {
  const datasets = extractDatasets(req.body);

  /*
    入参校验。app.js 的回退实现有这三条，这里一开始漏了——
    结果是「只发了 customers_v8」或者「projectId 根本不在 projects_v8 里」
    都会返回 200，调用方以为写成功了，实际什么该写的都没写。
    事务接口尤其不能这样：它的语义就是「要么整批成立，要么明确失败」。
  */
  if (!Array.isArray(datasets.projects_v8)) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'projects_v8 array is required', {}, 400);
  }
  const pid = String(req.body?.projectId || '').trim();
  const inPayload = pid ? datasets.projects_v8.find((x) => String(x?.id || '') === pid) : null;
  if (pid && !inPayload) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'projectId not found in projects_v8', {}, 400);
  }

  const result = await upsertDatasets(datasets);
  // 事务一次写多种数据集，镜像要按键逐个刷——只刷项目会让客户镜像留在旧版本
  await refreshMirrorsByKeys(result.keys, {
    project: projectRepo, customer: customerRepo,
    reminder: require('../repos/reminderRepo').reminderRepo,
    knowledge: require('../repos/knowledgeRepo').knowledgeRepo,
  }, { actorUserId: req.authUser?.id || '' });
  const project = pid ? await projectRepo.getById(pid) : null;
  sendSuccess(res, { written: result.written, keys: result.keys, project }, 'success');
}));

// 完成项目（原子级联）
router.post('/api/projects/:id/complete',
  requireAction('PROJECT_EDIT_INFO', { resource: projectResource }),
  wrap(async (req, res) => {
  const result = await completeProject(req.params.id, {
    source: req.body?.source, tasksOverride: req.body?.tasksOverride,
  });
  if (!result.ok) return sendFail(res, ERROR_CODES.DATA_CONFLICT, result.reason, {}, 409);
  const project = await projectRepo.getById(req.params.id);
  sendSuccess(res, { ...result, project }, 'success');
}));


/*
  指派负责人。与线索认领相对的另一条路：合同和项目牵扯金额与交付责任，
  不能自认领，必须由有指派权的人显式指定（见 constants.ts 的角色配置）。
  路由必须挂在这里、和业务数据用同一个 repo——写在 app.js 里读 state store
  会指到另一个存储上，永远 404。
*/
makeAssignOwnerRoute({
  router, path: '/api/projects/:id/owner', action: 'PROJECT_ASSIGN_OWNER',
  resourceType: 'project', repo: projectRepo, requireAction,
});


module.exports = router;
