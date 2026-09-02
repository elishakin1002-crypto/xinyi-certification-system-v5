// 看板指标后端化。复用前端 buildDashboardMetrics 的 esbuild 产物（零重写、零漂移）。
// 重新生成产物： npm run build:metrics
const { buildDashboardMetrics } = require('../generated/dashboardMetrics.cjs');
const { leadRepo } = require('../repos/leadRepo');
const { customerRepo } = require('../repos/customerRepo');
const { projectRepo } = require('../repos/projectRepo');
const { contractRepo } = require('../repos/contractRepo');
const { settlementRepo } = require('../repos/settlementRepo');

// 工作日志暂未迁 PG，从旧 state store 只读取用（批次2 增强项）
const loadWorkLogs = async () => {
  try {
    const { getStateBatch } = require('../stateStore');
    const state = await getStateBatch(['project_work_logs_v1']);
    const v = state?.datasets?.project_work_logs_v1;
    return Array.isArray(v) ? v : (v && Array.isArray(v.value) ? v.value : []);
  } catch {
    return [];
  }
};

const computeDashboard = async ({ role = 'boss', userName = '' } = {}) => {
  const VALID = ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'];
  const activeRole = VALID.includes(String(role).toUpperCase()) ? String(role).toUpperCase() : 'ADMIN';
  const [leads, customers, projects, contracts, settlements, projectWorkLogs] = await Promise.all([
    leadRepo.list(), customerRepo.list(), projectRepo.list(), contractRepo.list(), settlementRepo.list(), loadWorkLogs(),
  ]);
  const currentUser = { id: 'U-AI-AGENT', name: userName || 'AI 数字员工', roles: [activeRole], activeRole };
  return buildDashboardMetrics({ leads, customers, contracts, projects, projectWorkLogs, settlements, currentUser, activeRole });
};

module.exports = { computeDashboard };
