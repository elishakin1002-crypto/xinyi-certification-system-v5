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
export const RiskBadge: React.FC<{ level?: string; className?: string }> = ({ level, className }) => {
  const normalized = String(level || '').toLowerCase();
  const tone: Tone = normalized === 'high' ? 'red' : normalized === 'medium' || normalized === 'mid' ? 'amber' : 'emerald';
  const label = normalized === 'high' ? '高风险' : normalized === 'medium' || normalized === 'mid' ? '中风险' : '低风险';
  return <Badge tone={tone} className={className}>{label}</Badge>;
};
