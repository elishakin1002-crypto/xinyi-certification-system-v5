const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const emptyStatePath = (name) => {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return file;
};

const jsonFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  const body = await res.json();
  return { res, body };
};

test('project API preserves current Project shape for create, update, and task mutations', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-projects-api')
  });

  try {
    const empty = await jsonFetch(`${baseUrl}/api/projects`);
    assert.equal(empty.res.status, 200);
    assert.deepEqual(empty.body.data.projects, []);

    const create = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: {
          name: 'ISO 9001 认证交付项目',
          customerId: 'C-PROJ-1',
          contractRef: 'CT-PROJ-1',
          sourceType: 'contract',
          sourceRef: 'CT-PROJ-1',
          projectMode: 'delivery',
          projectCategory: 'Delivery',
          manager: '项目经理',
          deadline: '2026-06-30',
          duration: 45,
          projectType: 'Self-Operated',
          projectAmount: 98000,
          costStatus: '待补全',
          tasks: [
            {
              id: 'T-PROJ-1',
              title: '资料收集',
              deadline: '2026-05-20',
              status: 'Pending',
              priority: 'High',
              category: 'Core',
              owner: '项目经理'
            }
          ],
          serviceItems: [
            {
              id: 'SI-PROJ-1',
              name: 'ISO 9001',
              status: 'Pending',
              category: '体系认证',
              deliveryMode: 'Self'
            }
          ],
          settlementConfig: { rule: 'Ratio', value: 12, base: 'Revenue' }
        }
      })
    });
    assert.equal(create.res.status, 201);
    assert.equal(create.body.ok, true);
    const project = create.body.data.project;
    assert.match(project.id, /^P-/);
    assert.equal(project.name, 'ISO 9001 认证交付项目');
    assert.equal(project.customerId, 'C-PROJ-1');
    assert.equal(project.contractRef, 'CT-PROJ-1');
    assert.equal(project.sourceType, 'contract');
    assert.equal(project.sourceRef, 'CT-PROJ-1');
    assert.equal(project.projectMode, 'delivery');
    assert.equal(project.projectCategory, 'Delivery');
    assert.equal(project.manager, '项目经理');
    assert.equal(project.progress, 0);
    assert.equal(project.status, 'Active');
    assert.equal(project.paymentStatus, 'unpaid');
    assert.equal(project.deadline, '2026-06-30');
    assert.equal(project.duration, 45);
    assert.equal(project.projectType, 'Self-Operated');
    assert.equal(project.projectAmount, 98000);
    assert.equal(project.costStatus, '待补全');
    assert.equal(project.tasks[0].id, 'T-PROJ-1');
    assert.equal(project.tasks[0].title, '资料收集');
    assert.equal(project.serviceItems[0].name, 'ISO 9001');
    assert.equal(project.settlementConfig.value, 12);

    const update = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: {
          manager: '新项目经理',
          projectAmount: 120000,
          costStatus: '已确认'
        }
      })
    });
    assert.equal(update.res.status, 200);
    assert.equal(update.body.data.project.id, project.id);
    assert.equal(update.body.data.project.manager, '新项目经理');
    assert.equal(update.body.data.project.projectAmount, 120000);
    assert.equal(update.body.data.project.costStatus, '已确认');

    const taskCreate = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: {
          title: '文件编制',
          deadline: '2026-05-25',
          status: 'Pending',
          priority: 'Medium',
          category: 'Core',
          owner: '新项目经理'
        }
      })
    });
    assert.equal(taskCreate.res.status, 201);
    assert.match(taskCreate.body.data.task.id, /^T-/);
    assert.equal(taskCreate.body.data.task.title, '文件编制');
    assert.equal(taskCreate.body.data.project.tasks.length, 2);
    assert.equal(taskCreate.body.data.project.progress, 0);

    const taskUpdate = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}/tasks/T-PROJ-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: {
          status: 'Completed'
        }
      })
    });
    assert.equal(taskUpdate.res.status, 200);
    assert.equal(taskUpdate.body.data.task.id, 'T-PROJ-1');
    assert.equal(taskUpdate.body.data.task.status, 'Completed');
    assert.equal(taskUpdate.body.data.project.progress, 50);

    const detail = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`);
    assert.equal(detail.res.status, 200);
    assert.equal(detail.body.data.project.manager, '新项目经理');
    assert.equal(detail.body.data.project.tasks.length, 2);
    assert.equal(detail.body.data.project.tasks[0].status, 'Completed');

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=projects_v8`);
    assert.equal(state.res.status, 200);
    const storedProjects = state.body.data.datasets.projects_v8;
    assert.equal(storedProjects.length, 1);
    assert.equal(storedProjects[0].id, project.id);
    assert.equal(storedProjects[0].projectAmount, 120000);
    assert.equal(storedProjects[0].progress, 50);
  } finally {
    await stopServerProcess(child);
  }
});

test('project API returns 404 for missing project or task mutations', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-projects-api-missing')
  });

  try {
    const update = await jsonFetch(`${baseUrl}/api/projects/P-NOT-FOUND`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: { name: '不存在' } })
    });
    assert.equal(update.res.status, 404);
    assert.equal(update.body.ok, false);

    const taskCreate = await jsonFetch(`${baseUrl}/api/projects/P-NOT-FOUND/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { title: '不存在任务' } })
    });
    assert.equal(taskCreate.res.status, 404);
    assert.equal(taskCreate.body.ok, false);

    const create = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: { name: '空任务项目', manager: '项目经理' } })
    });
    assert.equal(create.res.status, 201);

    const taskUpdate = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(create.body.data.project.id)}/tasks/T-NOT-FOUND`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { status: 'Completed' } })
    });
    assert.equal(taskUpdate.res.status, 404);
    assert.equal(taskUpdate.body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});

test('project transaction API writes linked project datasets together', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-projects-transaction-api')
  });

  try {
    const project = {
      id: 'P-TXN-1',
      name: '项目事务测试',
      customerId: 'C-P-TXN-1',
      contractRef: 'CT-P-TXN-1',
      projectCategory: 'Delivery',
      manager: '项目事务负责人',
      progress: 100,
      status: 'Completed',
      paymentStatus: 'paid',
      deadline: '2026-05-31',
      projectType: 'Self-Operated',
      tasks: [{
        id: 'T-P-TXN-1',
        title: '事务任务',
        deadline: '2026-05-20',
        status: 'Completed',
        priority: 'High',
        category: 'Core',
        owner: '项目事务负责人'
      }],
      settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
    };
    const customer = {
      id: 'C-P-TXN-1',
      name: '项目事务客户',
      contactPerson: '事务联系人',
      totalValue: 0,
      riskStatus: 'low',
      activeContracts: 0,
      serviceCount: 1
    };
    const reminder = {
      id: 'REM-P-TXN-1',
      title: '项目事务提醒',
      content: '项目事务提醒内容',
      date: '2026-05-20',
      type: 'opportunity',
      isRead: false,
      linkId: customer.id,
      linkType: 'customer'
    };
    const workLog = {
      id: 'WLOG-P-TXN-1',
      projectId: project.id,
      taskId: 'T-P-TXN-1',
      logDate: '2026-05-20',
      workContent: '完成任务：事务任务',
      actualHours: 0.5,
      source: 'task_transition',
      operatorUserId: 'U-TEST',
      operatorName: '测试用户',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    };
    const knowledgeDoc = {
      id: 'DOC-P-TXN-1',
      title: '项目事务知识记录',
      category: 'PDCA',
      format: 'Markdown',
      size: '1 KB',
      updatedAt: '2026-05-20',
      tags: [`project:${project.id}`]
    };

    const commit = await jsonFetch(`${baseUrl}/api/projects/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        datasets: {
          projects_v8: [project],
          customers_v8: [customer],
          reminders_v8: [reminder],
          project_work_logs_v1: [workLog],
          knowledge_docs_v8: [knowledgeDoc],
          unsupported_v8: [{ id: 'ignored' }]
        }
      })
    });
    assert.equal(commit.res.status, 200);
    assert.equal(commit.body.ok, true);
    assert.equal(commit.body.data.written, 5);
    assert.deepEqual(
      commit.body.data.keys.sort(),
      ['customers_v8', 'knowledge_docs_v8', 'project_work_logs_v1', 'projects_v8', 'reminders_v8'].sort()
    );
    assert.equal(commit.body.data.project.id, project.id);

    const state = await jsonFetch(`${baseUrl}/api/state/sync?keys=projects_v8,customers_v8,reminders_v8,project_work_logs_v1,knowledge_docs_v8,unsupported_v8`);
    assert.equal(state.res.status, 200);
    assert.equal(state.body.data.datasets.projects_v8[0].id, project.id);
    assert.equal(state.body.data.datasets.customers_v8[0].id, customer.id);
    assert.equal(state.body.data.datasets.reminders_v8[0].id, reminder.id);
    assert.equal(state.body.data.datasets.project_work_logs_v1[0].projectId, project.id);
    assert.equal(state.body.data.datasets.knowledge_docs_v8[0].tags[0], `project:${project.id}`);
    assert.equal(state.body.data.datasets.unsupported_v8, undefined);
  } finally {
    await stopServerProcess(child);
  }
});

test('project transaction API rejects missing projects dataset or mismatched projectId', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-projects-transaction-api-invalid')
  });

  try {
    const missingProjects = await jsonFetch(`${baseUrl}/api/projects/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasets: { customers_v8: [] } })
    });
    assert.equal(missingProjects.res.status, 400);
    assert.equal(missingProjects.body.ok, false);

    const mismatchedProject = await jsonFetch(`${baseUrl}/api/projects/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'P-MISSING',
        datasets: {
          projects_v8: [{
            id: 'P-OTHER',
            name: '其他项目',
            contractRef: '',
            projectCategory: 'Delivery',
            manager: '负责人',
            progress: 0,
            status: 'Active',
            paymentStatus: 'unpaid',
            deadline: '2026-05-31',
            projectType: 'Self-Operated',
            tasks: [],
            settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
          }]
        }
      })
    });
    assert.equal(mismatchedProject.res.status, 400);
    assert.equal(mismatchedProject.body.ok, false);
  } finally {
    await stopServerProcess(child);
  }
});
