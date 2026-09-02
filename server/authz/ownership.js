// 数据归属：认领与指派。
//
// 背景：2026-08-21 查出库里**没有任何一条数据记着「这是谁的」**——
// 455 条线索、11 个客户、27 个项目的 owner_user_id 全为空，
// projects.manager 里填的是「销售 / 咨询」「待指派」这类岗位标签，不是人名。
// 后果是切 enforce 模式后全公司一条都改不了（读不受影响，所有角色 readScope=ALL）。
//
// 业务方定的两条路（见 authorize.js 的 OWNERSHIP_POLICY）：
//   线索      → 认领：谁跟进谁认领，改的瞬间归到他名下
//   合同/项目 → 指派：必须由管理者显式指定，不能自认领
//
// 这个模块把两件事收在一处，而不是散在各个路由里各写一遍——
// 归属是权限的地基，散开写必然出现某个路由忘了认领、数据永远无主的情况。
const { businessEventRepo } = require('../repos/businessEventRepo');

/** 归属字段统一叫这两个名字，改动前先全局搜一遍 */
const OWNER_ID_FIELD = 'ownerUserId';
const OWNER_NAME_FIELD = 'ownerName';

/**
 * 认领：把无主记录归到操作人名下。
 *
 * 只在 authorize() 返回 claimsOwnership 时调用——判定权在授权层，
 * 这里只负责执行，不重复判权限（两处判权必然漂移）。
 *
 * @returns 要合并进更新负载的补丁；不该认领时返回空对象
 */
const claimPatch = (decision, actor) => {
  if (!decision?.claimsOwnership) return {};
  if (!actor?.id) return {};
  return { [OWNER_ID_FIELD]: actor.id, [OWNER_NAME_FIELD]: actor.name || '' };
};

/**
 * 记一条归属变更事件。
 *
 * 归属决定了谁能改这条数据，属于权限性质的变更，必须进 Action Ledger：
 * 将来出现「这条合同怎么变成他的了」的争议时，账本要答得出是谁在什么时候改的。
 * 账本是追加式的（迁移 013 的触发器挡住 UPDATE/DELETE），改不了也删不掉。
 */
const recordOwnershipChange = async ({
  kind,            // 'claim' | 'assign'
  resourceType,
  resourceId,
  actor,           // 操作人
  toUserId,        // 新负责人
  toName,
  fromUserId,      // 原负责人（认领场景为空）
  policy,
  reason,
}) => businessEventRepo.record({
  eventType: `ownership.${kind}`,
  subjectType: resourceType,
  subjectId: resourceId,
  actorUserId: actor?.id || '',
  actorName: actor?.name || '',
  viaAiAgent: Boolean(actor?.viaAiAgent),
  onBehalfOf: actor?.onBehalfOf || null,
  summary: kind === 'claim'
    ? `${actor?.name || actor?.id} 认领了无主${resourceTypeLabel(resourceType)}`
    : `${actor?.name || actor?.id} 将${resourceTypeLabel(resourceType)}指派给 ${toName || toUserId}`,
  reason: reason || '',
  policy: policy || '',
  result: 'success',
  detail: { kind, from: fromUserId || null, to: toUserId || null, toName: toName || '' },
});

const LABELS = { lead: '线索', customer: '客户', contract: '合同', project: '项目' };
const resourceTypeLabel = (t) => LABELS[t] || t;

/**
 * 从一条业务记录里读出授权判定需要的归属信息。
 *
 * 各表字段名不统一（contracts 用 owner，projects 用 manager，
 * 其余用 owner_user_id），这里统一成 authorize() 认识的形状。
 * 不统一字段名是历史包袱，短期内不动表结构，先在这层收口。
 */
const resourceOf = (type, row = {}) => ({
  type,
  id: String(row.id || ''),
  ownerUserId: row.ownerUserId || row.owner_user_id || '',
  ownerName: row.ownerName || row.owner_name || row.owner || '',
  manager: row.manager || '',
  participantUserIds: row.participantUserIds || row.participant_user_ids || [],
  participantNames: row.participantNames || row.participant_names || [],
});

/**
 * 生成一条「指派负责人」路由。
 *
 * 三种资源（线索/合同/项目）逻辑完全一样，只有 repo 不同，所以用工厂生成。
 * **必须挂在各自的 batch 路由里、用同一个 repo**——
 * 第一版把这三条路由写在 app.js 里、读写 state store 数据集，
 * 而真实数据走的是 batch 路由的 PG repo，两边不是同一个存储，
 * 结果指派永远 404（而且测试没断言状态码，差点漏过去）。
 *
 * @param repo  需要 getById(id) 和 update(id, patch)
 */
const makeAssignOwnerRoute = ({ router, path, action, resourceType, repo, requireAction }) => {
  router.patch(path,
    requireAction(action, {
      resource: async (req) => resourceOf(resourceType, (await repo.getById(req.params?.id)) || {}),
    }),
    async (req, res) => {
      const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
      try {
        const id = String(req.params.id || '').trim();
        const toUserId = String(req.body?.ownerUserId || '').trim();
        const toName = String(req.body?.ownerName || '').trim();
        // 指派必须落到具体的人。只给名字不行——名字会重、会改，权限判定认的是 id。
        if (!toUserId) return sendFail(res, ERROR_CODES.PARAM_ERROR, '必须指定负责人 ownerUserId', {}, 400);

        const before = await repo.getById(id);
        if (!before) return sendFail(res, ERROR_CODES.NOT_FOUND, '记录不存在', {}, 404);

        const after = await repo.update(id, { ownerUserId: toUserId, ownerName: toName });

        await recordOwnershipChange({
          kind: 'assign', resourceType, resourceId: id,
          actor: { ...req.authUser, viaAiAgent: Boolean(req.aiActor) },
          toUserId, toName,
          fromUserId: before?.ownerUserId || '',
          policy: req.authzDecision?.policy,
          reason: String(req.body?.reason || ''),
        });

        return sendSuccess(res, { [resourceType]: after, ownerUserId: toUserId, ownerName: toName }, 'success');
      } catch (error) {
        return sendFail(res, ERROR_CODES.STATE_SYNC_ERROR, error?.message || '指派失败', {}, 500);
      }
    });
};

module.exports = {
  claimPatch, recordOwnershipChange, resourceOf, resourceTypeLabel, makeAssignOwnerRoute,
  OWNER_ID_FIELD, OWNER_NAME_FIELD,
};
