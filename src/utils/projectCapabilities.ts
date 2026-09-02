import { Project, ProjectMode, ProjectSourceType, ServiceItem } from '../../types';

const isValidSourceType = (value: unknown): value is ProjectSourceType => (
  value === 'intel' || value === 'lead' || value === 'customer' || value === 'contract' || value === 'manual'
);

const isValidProjectMode = (value: unknown): value is ProjectMode => (
  value === 'followup' || value === 'delivery'
);

const parseLegacyProjectRef = (ref: string | undefined): { sourceType?: ProjectSourceType; sourceRef?: string } => {
  const raw = String(ref || '').trim();
  if (!raw || raw === '无关联') return {};

  if (raw.startsWith('INTEL:')) return { sourceType: 'intel', sourceRef: raw.slice('INTEL:'.length) };
  if (raw.startsWith('LEAD:')) return { sourceType: 'lead', sourceRef: raw.slice('LEAD:'.length) };
  if (raw.startsWith('CUSTCERT:')) return { sourceType: 'customer', sourceRef: raw.slice('CUSTCERT:'.length) };
  if (raw.startsWith('CUST:')) return { sourceType: 'customer', sourceRef: raw.slice('CUST:'.length) };

  return { sourceType: 'contract', sourceRef: raw };
};

export const resolveProjectMode = (project: Pick<Project, 'projectMode' | 'projectCategory' | 'contractRef'>): ProjectMode => {
  if (isValidProjectMode(project.projectMode)) return project.projectMode;
  if (project.projectCategory === 'FollowUp') return 'followup';
  if (project.projectCategory === 'Delivery') return 'delivery';

  const legacy = parseLegacyProjectRef(project.contractRef);
  if (legacy.sourceType === 'intel' || legacy.sourceType === 'lead' || legacy.sourceType === 'customer') return 'followup';
  return 'delivery';
};

export const resolveProjectSourceType = (project: Pick<Project, 'sourceType' | 'contractRef' | 'projectMode' | 'projectCategory'>): ProjectSourceType => {
  if (isValidSourceType(project.sourceType)) return project.sourceType;

  const legacy = parseLegacyProjectRef(project.contractRef);
  if (legacy.sourceType) return legacy.sourceType;

  return 'manual';
};

export const resolveProjectSourceRef = (project: Pick<Project, 'sourceRef' | 'contractRef'>): string => {
  if (typeof project.sourceRef === 'string' && project.sourceRef.trim()) return project.sourceRef.trim();
  const legacy = parseLegacyProjectRef(project.contractRef);
  return legacy.sourceRef || '';
};

export const inferProjectMeta = (project: Pick<Project, 'sourceType' | 'sourceRef' | 'projectMode' | 'projectCategory' | 'contractRef'>) => {
  const projectMode = resolveProjectMode(project);
  const sourceType = resolveProjectSourceType(project);
  const sourceRef = resolveProjectSourceRef(project);
  return { projectMode, sourceType, sourceRef };
};

export const resolveProjectCapabilities = (project: Pick<Project, 'sourceType' | 'sourceRef' | 'projectMode' | 'projectCategory' | 'contractRef'>) => {
  const { projectMode, sourceType, sourceRef } = inferProjectMeta(project);
  const isFollowUpProject = projectMode === 'followup';
  const isIntelOrigin = sourceType === 'intel';
  return {
    projectMode,
    sourceType,
    sourceRef,
    isFollowUpProject,
    isIntelOrigin,
    showFinancePanel: !isIntelOrigin,
    showServicePanel: !isIntelOrigin,
    allowFastFollowUpComplete: isFollowUpProject && isIntelOrigin
  };
};

/**
 * 每个项目至少有一个服务项（P0-审查⑥）。
 *
 * 原设计里服务项是可选的，结果 24 个项目里 16 个没有服务项、任务直接挂在项目上。
 * 于是系统里同时存在两种项目结构，进度、分组、负责人、结算的下游逻辑
 * 都要处理两种情况，界面也长得不一样——这是复杂度和 bug 的来源。
 *
 * 但服务项这一层本身是必要的：一个合同可能含 ISO9001 + ISO14001 + HACCP，
 * 交付负责人和任务流完全不同，没有这层三套任务混在一个列表里没法看。
 *
 * 解法不是强制用户先建服务项（那是增加录入负担），而是建项目时自动建一个
 * 与项目同名的默认服务项。单体系项目用户感知不变（还是一个扁平任务列表），
 * 多体系时加第二个服务项即可，不需要「改结构」。
 */
export const buildDefaultServiceItem = (params: {
  projectId: string;
  projectName: string;
  owner?: string;
}): ServiceItem => ({
  id: `SVC-DEFAULT-${params.projectId}`,
  name: params.projectName,
  owner: params.owner || '',
  status: 'Pending',
  // 默认服务项只是承载任务的容器，不再自动生成一套任务
  autoGenerateTasks: false,
});

/** 把还没归属服务项的任务挂到默认服务项下，保证任务不会「悬空」 */
export const attachTasksToDefaultService = <T extends { serviceItemId?: string }>(
  tasks: T[],
  serviceItemId: string
): T[] => tasks.map(t => (t.serviceItemId ? t : { ...t, serviceItemId }));
