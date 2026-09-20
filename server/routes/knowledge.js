// 知识库路由（PG 新表）。含 Agent 级联自动生成的 PDCA 文档。
// DB 未启用 → next('router')。
const express = require('express');
const pool = require('../db/pool');
const { knowledgeRepo } = require('../repos/knowledgeRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { explainDbError } = require('../utils/dbErrors');
const { requireAction } = require('../authz/middleware');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

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
    sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'knowledge error', {}, 500);
  }
};
const payload = (b) => (b?.doc && typeof b.doc === 'object' ? b.doc : (b || {}));

/*
  ── 可见范围要在服务端生效，不能只在浏览器里过滤（2026-09-20）──

  改之前这个接口**把所有文档返回给所有人**，过滤全在前端
  （Knowledge.tsx 的 canAccessDoc、AIChatWidget 的 allowedDocs）。

  后果：顾问的浏览器里其实装着财务和总经理的文档，
  打开开发者工具、或者看一眼网络请求就能读到。
  也就是说「可见范围」是个**显示过滤，不是访问控制**。

  这正是联网查到的企业 RAG 通病 ——
  「大多数企业把权限做在应用层，结果把机密文档泄露给了错误的人」。
  权限必须跟着数据走，在**数据出服务端之前**就滤掉。

  两条规矩：
    · 总经理和系统管理员看全部（负责人 + 维护角色，见 visibility.ts）
    · accessRoles 为空 = 全员可见（这是这个系统既有的约定，别改语义）
*/
const ALWAYS_SEE_ALL = ['ADMIN', 'SYS_ADMIN'];

const visibleTo = (doc, user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.some((r) => ALWAYS_SEE_ALL.includes(r))) return true;

  const users = Array.isArray(doc?.accessUserIds) ? doc.accessUserIds : [];
  if (users.length > 0 && !users.includes(user?.id)) return false;

  const allowed = Array.isArray(doc?.accessRoles) ? doc.accessRoles : [];
  if (allowed.length === 0) return true;                       // 空 = 全员可见
  return allowed.some((r) => roles.includes(r));
};

router.get('/api/knowledge', wrap(async (req, res) => {
  const docs = await knowledgeRepo.list({ linkType: req.query.linkType, linkId: req.query.linkId, category: req.query.category });
  /*
    没有登录态时（本机开发、鉴权关掉的环境）不做过滤 ——
    那种环境本来就没有"谁在问"这个概念，硬过滤会让本地开发
    看不到任何文档，然后有人把这段注释掉，规则就没了。
  */
  const user = req.authUser;
  sendSuccess(res, { docs: user ? docs.filter((d) => visibleTo(d, user)) : docs }, 'success');
}));

router.get('/api/knowledge/:id', wrap(async (req, res) => {
  const doc = await knowledgeRepo.getById(req.params.id);
  if (!doc) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Doc not found', {}, 404);
  /*
    单篇也要拦。只滤列表的话，知道 id 就能绕过去 ——
    而 id 在列表里出现过、在链接里出现过，不是秘密。
    返回 404 而不是 403：不告诉对方"这篇存在但你看不了"。
  */
  if (req.authUser && !visibleTo(doc, req.authUser)) {
    return sendFail(res, ERROR_CODES.NOT_FOUND, 'Doc not found', {}, 404);
  }
  sendSuccess(res, { doc }, 'success');
}));


/*
  内容太短的文档一律不进 AI 语料，不管调用方怎么标。

  它们对检索**毫无用处却要花钱**：每次检索都要过一遍，token 按量算。
  更糟的是污染——空白模板和记录表单在 100 家客户之间高度雷同，
  会把真正有价值的复盘和案例从检索结果里挤下去，
  于是 AI 答出来的东西越来越像模板。

  阈值取 200 字：一份连 200 字都没有的文档，要么是空表单，
  要么正文没抽出来（扫描件、加密 PDF），两种情况都不该进语料。
  抽取失败时静默进语料是最坏的一种——花了钱，学到的是文件名。

  放在服务端而不是界面上：界面绕得过去，接口和批量导入也会写这个字段。
*/
const MIN_AI_CONTENT_LENGTH = 200;

/*
  ── 可见范围不许把总经理排除在外（2026-09-20）──────────────────

  金恩来：「知识中心给了顾问上传文件时可以选择可见范围的能力，
    这个不合理！意思是员工可以上传文件不让老板看见。」

  文档管理系统的通行做法是：权限由管理员设定，而且
  **公司所有者永远拥有完整可见性**。上传的人只能往下收窄。

  和 guardAiVisible 一样放在服务端：界面上把那个勾置灰是给人看的，
  接口、批量导入、以后别的写入路径绕得过去。规矩要落在**必经之路**上。

  规则本身在 src/modules/knowledge/visibility.ts，前后端共用一份，
  免得两边慢慢长成两套。
*/
const ALWAYS_VISIBLE_ROLES = ['ADMIN'];

const guardVisibleRoles = (body = {}) => {
  const next = { ...body };
  if (!Array.isArray(next.accessRoles) || next.accessRoles.length === 0) return next;  // 空 = 全员可见
  const roles = next.accessRoles.filter(Boolean).map(String);
  for (const must of ALWAYS_VISIBLE_ROLES) {
    if (!roles.includes(must)) roles.push(must);
  }
  next.accessRoles = roles;
  return next;
};

const guardAiVisible = (body = {}) => {
  const next = { ...body };
  if (next.aiVisible !== true) return next;
  const text = String(next.content || '').trim();
  if (text.length < MIN_AI_CONTENT_LENGTH) {
    next.aiVisible = false;
    next.aiVisibleBlockedReason = `正文只有 ${text.length} 字（少于 ${MIN_AI_CONTENT_LENGTH}），不纳入 AI 语料`;
  }
  return next;
};

router.post('/api/knowledge',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  /*
    ── 空 body 不许建出记录（2026-09-13）────────────────────────

    金恩来看见知识中心里一堆没标题的条目。追下去发现是
    `npm run checkup:authz` 造的：那个脚本给每个非 GET 接口发 `{}`
    来验鉴权，而这里空 body 也照样 201 —— 于是每跑一次巡检
    就多出几条空壳文档。09-11 那 25 条就是这么来的。

    **发空 body 是对的**（要验的是 403 和非 403），
    错的是建接口不校验。contracts / projects / customers / leads
    早就补了 400，唯独知识中心和合同一样漏了。

    标题是最低要求：没有标题的文档，列表上认不出、搜也搜不到，
    存在本身就是噪音。
  */
  const body = payload(req.body) || {};
  if (!String(body.title || '').trim()) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR,
      '缺少文档标题。没有标题的文档在列表里认不出、也搜不到，等于存了个空壳。', {}, 400);
  }
  const doc = await knowledgeRepo.create({ source: 'manual', ...guardVisibleRoles(guardAiVisible(body)) });
  sendSuccess(res, { doc }, 'success', ERROR_CODES.SUCCESS, 201);
}));

router.patch('/api/knowledge/:id',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  if (!(await knowledgeRepo.getById(req.params.id))) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Doc not found', {}, 404);
  const doc = await knowledgeRepo.update(req.params.id, guardVisibleRoles(guardAiVisible(payload(req.body))));
  sendSuccess(res, { doc }, 'success');
}));

router.delete('/api/knowledge/:id',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  /*
    把操作人带下去写进墓碑。

    这个项目的第一条铁律是「谁做的这条链不能断」，
    而在墓碑出现之前，**删除是全系统唯一没有留痕的动作** ——
    东西没了，没人知道是谁删的、什么时候删的。
  */
  await knowledgeRepo.remove(req.params.id, {
    userId: req.authUser?.id || '',
    userName: req.authUser?.name || '',
    reason: String(req.body?.reason || req.query?.reason || '')
  });
  sendSuccess(res, { ok: true }, 'success');
}));

module.exports = router;
