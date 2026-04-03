import { Project, ProjectMode, ProjectSourceType } from '../../types';

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
