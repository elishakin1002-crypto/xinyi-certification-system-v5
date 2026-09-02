// 审计问题 → 项目整改任务 同步（后端）。移植 syncAuditRectificationTask 核心：
// issue 关联 projectId 时，在该项目 upsert 一条整改任务；status=Closed 则任务完成；回写 issue.rectificationTaskId。
const { projectRepo } = require('../repos/projectRepo');
const { auditRepo } = require('../repos/batch4Repos');

const calcProgress = (tasks = []) => {
  if (!tasks.length) return 0;
  const core = tasks.filter((t) => t.category === 'Core');
  if (!core.length) return 0;
  return Math.round((core.filter((t) => t.status === 'Completed').length / core.length) * 100);
};

const title = (issue) => `【整改】${issue.findings || issue.customerName || '审计问题'}`.slice(0, 60);

// 返回可能更新过的 issue（含 rectificationTaskId）
const syncRectificationTask = async (issue) => {
  const projectId = issue.projectId;
  if (!projectId) return issue;
  const project = await projectRepo.getById(projectId);
  if (!project) return issue;

  const tasks = Array.isArray(project.tasks) ? [...project.tasks] : [];
  const payload = {
    title: title(issue),
    deadline: String(issue.deadline || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    status: issue.status === 'Closed' ? 'Completed' : 'Pending',
    priority: issue.severity === 'Major' ? 'High' : 'Medium',
    category: 'Core',
    owner: issue.auditor || project.manager || '待指派',
  };

  let taskId = issue.rectificationTaskId;
  const idx = taskId ? tasks.findIndex((t) => t.id === taskId) : -1;
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...payload };
  } else {
    taskId = `T-AUD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    tasks.push({ id: taskId, ...payload });
  }

  await projectRepo.update(projectId, { tasks, progress: calcProgress(tasks) });

  if (issue.rectificationTaskId !== taskId) {
    return auditRepo.update(issue.id, { rectificationTaskId: taskId });
  }
  return issue;
};

module.exports = { syncRectificationTask };
