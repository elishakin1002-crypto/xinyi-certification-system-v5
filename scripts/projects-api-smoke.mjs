const backendBase = String(process.env.PROJECTS_API_BASE || process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const probePrefix = String(process.env.PROJECTS_API_SMOKE_PREFIX || 'SMOKE项目').trim() || 'SMOKE项目';

const headers = {
  'Content-Type': 'application/json',
  ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
};

const checks = [];

const record = (name, pass, details = {}) => {
  checks.push({ name, pass: Boolean(pass), ...details });
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
};

const requestJson = async (path, options = {}) => {
  const started = Date.now();
  const res = await fetch(`${backendBase}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });
  const { text, json } = await readJson(res);
  const elapsedMs = Date.now() - started;
  if (!json || typeof json !== 'object') {
    throw new Error(`invalid json from ${path}: HTTP ${res.status} ${String(text || '').slice(0, 120)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`request failed ${path}: HTTP ${res.status} ${json.message || String(text || '').slice(0, 120)}`);
  }
  return { res, json, elapsedMs };
};

const run = async () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8);
  const name = `${probePrefix}-${stamp}-${rand}`;
  const updatedManager = `SMOKE负责人-${rand}`;
  const taskTitle = `SMOKE任务-${stamp}`;

  const listBefore = await requestJson('/api/projects');
  const initialProjects = Array.isArray(listBefore.json?.data?.projects) ? listBefore.json.data.projects : null;
  record('projects-list-before', Array.isArray(initialProjects), {
    status: listBefore.res.status,
    elapsedMs: listBefore.elapsedMs,
    total: initialProjects?.length ?? -1
  });

  const create = await requestJson('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      project: {
        name,
        contractRef: `SMOKE-CONTRACT-${stamp}-${rand}`,
        projectCategory: 'Delivery',
        manager: 'SMOKE负责人',
        deadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        projectType: 'Self-Operated',
        projectAmount: 98000,
        tasks: [
          {
            title: 'SMOKE资料收集',
            deadline: new Date().toISOString().slice(0, 10),
            status: 'Pending',
            priority: 'High',
            category: 'Core',
            owner: 'SMOKE负责人'
          }
        ],
        settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
      }
    })
  });
  const project = create.json?.data?.project;
  record('project-create', Boolean(project?.id && project.name === name), {
    status: create.res.status,
    elapsedMs: create.elapsedMs,
    projectId: project?.id || ''
  });
  if (!project?.id) throw new Error('project-create did not return project.id');

  const createdReadback = await requestJson(`/api/projects/${encodeURIComponent(project.id)}`);
  const createdProject = createdReadback.json?.data?.project;
  record('project-create-readback', createdProject?.id === project.id && createdProject?.name === name, {
    status: createdReadback.res.status,
    elapsedMs: createdReadback.elapsedMs
  });

  const update = await requestJson(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      project: {
        manager: updatedManager,
        projectAmount: 120000,
        costStatus: '已确认'
      }
    })
  });
  const updatedProject = update.json?.data?.project;
  record('project-update', updatedProject?.id === project.id && updatedProject?.manager === updatedManager && updatedProject?.costStatus === '已确认', {
    status: update.res.status,
    elapsedMs: update.elapsedMs
  });

  const taskCreate = await requestJson(`/api/projects/${encodeURIComponent(project.id)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      task: {
        title: taskTitle,
        deadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        status: 'Pending',
        priority: 'Medium',
        category: 'Core',
        owner: updatedManager
      }
    })
  });
  const task = taskCreate.json?.data?.task;
  record('project-task-create', Boolean(task?.id && task.title === taskTitle), {
    status: taskCreate.res.status,
    elapsedMs: taskCreate.elapsedMs,
    taskId: task?.id || ''
  });
  if (!task?.id) throw new Error('project-task-create did not return task.id');

  const taskUpdate = await requestJson(`/api/projects/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(task.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      task: {
        status: 'Completed'
      }
    })
  });
  const updatedTask = taskUpdate.json?.data?.task;
  record('project-task-update', updatedTask?.id === task.id && updatedTask?.status === 'Completed', {
    status: taskUpdate.res.status,
    elapsedMs: taskUpdate.elapsedMs,
    progress: taskUpdate.json?.data?.project?.progress ?? ''
  });

  const stateReadback = await requestJson('/api/state/sync?keys=projects_v8');
  const stateProjects = stateReadback.json?.data?.datasets?.projects_v8;
  record('state-projects-readback', Array.isArray(stateProjects) && stateProjects.some((item) => item.id === project.id && item.manager === updatedManager), {
    status: stateReadback.res.status,
    elapsedMs: stateReadback.elapsedMs,
    total: Array.isArray(stateProjects) ? stateProjects.length : -1
  });

  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const meta = Object.entries(check)
      .filter(([key]) => !['name', 'pass'].includes(key))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ');
    console.log(`${flag} | ${check.name}${meta ? ` | ${meta}` : ''}`);
  });

  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} projectId=${project.id} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[projects-api-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
