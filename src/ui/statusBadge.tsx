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
  project: {
    [Status.Active]: '执行中',
    [Status.Completed]: '已结项',
    [Status.Risk]: '风险',
    [Status.Pending]: '待启动'
  },
  contract: {
    [Status.Active]: '执行中',
    [Status.Completed]: '已完成',
    [Status.Risk]: '风险',
    [Status.Pending]: '待生效'
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
