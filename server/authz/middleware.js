// 授权中间件。挂在路由上：requireAction('CONTRACT_CREATE', { resource: ... })
//
// 上线策略：**先观察，后拦截**。
//   XINYI_AUTHZ_MODE=observe（默认）→ 判定 + 记 Ledger，但一律放行
//   XINYI_AUTHZ_MODE=enforce        → 判定不通过直接 403
//
// 为什么不一上来就拦：规则是我按业务口径推的，一定有没想到的场景。
// 直接开拦截，同事明天上班就被挡在门外，而且会怪到系统头上。
// 先观察一周，看 Ledger 里积了哪些 denied——那批就是真实的越权尝试和误配规则，
// 据此调完再打开，比拍脑袋定策略靠谱。
const { authorize } = require('./authorize');
const { businessEventRepo } = require('../repos/businessEventRepo');

const MODE = String(process.env.XINYI_AUTHZ_MODE || 'observe').toLowerCase();
const isEnforcing = () => MODE === 'enforce';

/** 从请求里取出操作人。AI 代表执行时 req.authUser 已被换成被代表人 */
const actorOf = (req) => ({
  id: req.authUser?.id || '',
  name: req.authUser?.name || '',
  roles: req.authUser?.roles || (req.authUser?.activeRole ? [req.authUser.activeRole] : []),
  extraActions: req.authUser?.extraActions || [],
  deniedActions: req.authUser?.deniedActions || [],
  accountExpiresAt: req.authUser?.accountExpiresAt,
  status: req.authUser?.status,
  viaAiAgent: Boolean(req.aiActor),
  onBehalfOf: req.aiActor ? (req.authUser?.id || '') : null,
});

/**
 * @param action 动作码
 * @param opts.resource   (req) => resource 对象。异步取资源时用 await，中间件已是 async
 * @param opts.amountFen  (req) => 金额（分），用于金额门槛
 * @param opts.creating   true = 这条路由在**新建**资源（目标此刻还不存在），
 *                        跳过归属与范围判定。用于 POST /api/settlements 这类
 *                        动作码本身不是新建码、但路由确实在建东西的场合。
 */
const requireAction = (action, opts = {}) => async (req, res, next) => {
  let decision;
  try {
    const user = actorOf(req);
    const resource = typeof opts.resource === 'function' ? await opts.resource(req) : (opts.resource || {});
    const amountFen = typeof opts.amountFen === 'function' ? await opts.amountFen(req) : opts.amountFen;
    decision = authorize({ user, action, resource, amountFen, viaAiAgent: user.viaAiAgent,
      creating: Boolean(opts.creating) });

    // 判定结果挂到 req，后续处理器可以据此决定「入队还是直接执行」（L3 vs L4）
    req.authzDecision = decision;

    if (!decision.allow) {
      await businessEventRepo.recordDenied({
        actor: user,
        action,
        resource: { type: resource.type || 'unknown', id: resource.id || req.params?.id || '' },
        policy: decision.policy,
        reason: decision.reason,
        aiLevel: decision.aiLevel,
      });

      if (isEnforcing()) {
        return res.status(403).json({
          ok: false, code: 4030,
          message: decision.reason || '无权限执行该操作',
          data: { action, policy: decision.policy, aiLevel: decision.aiLevel || null },
        });
      }
      // observe 模式：记下来但放行，并在响应头上留个记号方便排查
      res.setHeader('X-Authz-Would-Deny', encodeURIComponent(decision.policy || action));
    }
  } catch (e) {
    /*
      ── 判定本身出错时怎么办 ──────────────────────────────────
      observe 阶段：放行。那时判定还不可信，一个解析 bug 把全公司挡在门外，
      代价远大于漏判。

      enforce 阶段：**拒绝**。这是安全的默认——判定不出结果就不能假设「允许」，
      否则只要能让判定崩掉就等于拿到了所有权限。

      但拒绝要**吵**：错误码和提示都跟「真的没权限」明确区分开。
      不区分的话，同事看到「无权限」会去找老板要权限，而真正的问题是系统坏了——
      于是没人报修，故障一直在。

      出事时的退路：设 XINYI_AUTHZ_FAILOPEN=1 立刻恢复放行，
      不用改代码、不用重新部署。这条留给「周一早上全员干不了活」那种时刻。
    */
    console.error('[authz] ⚠️ 判定异常:', e?.message, '| action=', action);
    try {
      await businessEventRepo.recordDenied({
        actor: actorOf(req), action,
        resource: { type: opts.resourceType || 'unknown', id: req.params?.id || '' },
        policy: 'authz.error', reason: `判定异常：${e?.message || e}`,
      });
    } catch { /* 连记账都失败了就别再抛，主流程要有个结果 */ }

    const failOpen = String(process.env.XINYI_AUTHZ_FAILOPEN || '') === '1';
    if (isEnforcing() && !failOpen) {
      return res.status(500).json({
        ok: false, code: 5031,
        message: '授权判定出错，操作已中止。这不是权限不足——请把这条报给系统维护人，不要找人要权限。',
        data: { action, authzError: true },
      });
    }
    res.setHeader('X-Authz-Error', '1');
  }
  return next();
};

/**
 * 读接口的范围注入。
 * **忽略并覆盖客户端传的 owner 参数**——这是整件事的关键：
 * 改之前 leadRepo 的归属过滤来自 req.query.owner，改个 URL 就能看全部数据。
 */
const injectScope = (resourceType) => (req, res, next) => {
  const { resolveScope } = require('./authorize');
  const user = actorOf(req);
  const scope = resolveScope(user, 'read');
  req.authzScope = {
    type: resourceType,
    scope,
    // OWN 时强制按当前用户过滤；客户端只能在此范围内进一步收窄，不能放宽
    ownerUserId: scope === 'ALL' ? null : user.id,
    ownerName: scope === 'ALL' ? null : user.name,
  };
  return next();
};

module.exports = { requireAction, injectScope, actorOf, MODE, isEnforcing };
