/**
 * 全站统一的状态徽章。
 *
 * 原本线索、项目、审改各自实现了一份 getStatusBadge，形状、字号、配色都不同。
 * 这里收成一处：同一个 Status 在不同页面语义不同（Active 在项目是「执行中」、
 * 在合同是「执行中」、在线索没有），所以按 domain 给不同文案，但配色和形状固定。
 */
import React from 'react';
import { Status } from '../../types';
import { Badge, Tone } from './index';
import { TERM_PROJECT, TERM_CONTRACT } from '../modules/glossary';
import { contractRiskLabel, contractRiskTone } from '../modules/labels';

export type StatusDomain = 'lead' | 'project' | 'contract';

const TONE_BY_STATUS: Record<Status, Tone> = {
  [Status.New]: 'blue',
  [Status.Pending]: 'amber',
  [Status.Converted]: 'emerald',
  [Status.Risk]: 'red',
  [Status.Lost]: 'gray',
  [Status.Active]: 'blue',
  [Status.Completed]: 'emerald'
};

const LABEL_BY_DOMAIN: Record<StatusDomain, Partial<Record<Status, string>>> = {
  lead: {
    [Status.New]: '新增',
    [Status.Pending]: '跟进中',
    [Status.Converted]: '已转化',
    [Status.Risk]: '高风险',
    [Status.Lost]: '已丢失'
  },
  /*
    项目和合同**故意用不同的词**（项目「进行中/已结项」、合同「执行中/已完成」），
    理由写在术语表里。但两边都必须引常量：
    2026-09-17 之前这里项目写「执行中」，而筛选下拉和统计卡写「进行中」，
    人按「进行中」筛出来，每一行却写着「执行中」。
    写字面量就没有任何机制拦得住下一个人再造一个说法。
  */
  project: {
    [Status.Active]: TERM_PROJECT.statusActive,
    [Status.Completed]: TERM_PROJECT.statusCompleted,
    [Status.Risk]: TERM_PROJECT.statusRisk,
    [Status.Pending]: TERM_PROJECT.statusPending
  },
  contract: {
    [Status.Active]: TERM_CONTRACT.statusActive,
    [Status.Completed]: TERM_CONTRACT.statusCompleted,
    [Status.Risk]: TERM_CONTRACT.statusRisk,
    [Status.Pending]: TERM_CONTRACT.statusPending
  }
};

export const statusLabel = (status: Status, domain: StatusDomain) =>
  LABEL_BY_DOMAIN[domain][status] || String(status);

export const StatusBadge: React.FC<{ status: Status; domain: StatusDomain; className?: string }> = ({
  status,
  domain,
  className
}) => (
  <Badge tone={TONE_BY_STATUS[status] || 'gray'} className={className}>
    {statusLabel(status, domain)}
  </Badge>
);

/** 风险等级徽章（客户 riskStatus / 合同 riskLevel 共用） */
/*
  ── 认不出来的值不许显示成「低风险」（2026-09-17 修）────────────

  这个组件原来写的是「不是 high 也不是 medium，就是低风险」，
  而且**没有任何页面在用它** —— 合同页桌面和手机各写了一套三元表达式，
  手机那套只判 High，于是**同一份中风险合同在手机上显示「正常」**，
  风险提示凭空消失（字段排查 C19）。

  两个错叠在一起：
    1. 两处各写一套 → 手机那套漏了 Medium
    2. 兜底回退成绿色的「低风险」→ 没评估过的合同看起来像已确认安全

  第 2 条和「没有正在生效的登录」「0 次越权请求」是同一条规矩：
  **别把"不知道"说成一个让人放心的结论。**
  所以缺值显示「未评估」，配中性灰，不给绿色。

  口径收在 src/modules/labels.ts，页面只能调它，不能自己写字面量。
*/
export const RiskBadge: React.FC<{ level?: string; className?: string }> = ({ level, className }) => (
  <Badge tone={contractRiskTone(level) as Tone} className={className}>{contractRiskLabel(level)}</Badge>
);
