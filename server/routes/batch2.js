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
const { requireAction } = require('../authz/middleware');
const { refreshMirror, refreshMirrorsByKeys } = require('../services/datasetMirror');
const { makeAssignOwnerRoute, resourceOf } = require('../authz/ownership');

const router = express.Router();
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
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch2 error', {}, 500); }
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
