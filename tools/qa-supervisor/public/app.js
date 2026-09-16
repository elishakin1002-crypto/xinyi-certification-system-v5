let state = null;
let actorFilter = 'all';
const $ = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));

function eventHtml(item) {
  const actorClass = item.actor === 'Claude' ? 'claude' : 'codex';
  return `<article class="event ${item.kind}"><div class="avatar ${actorClass}">${item.actor === 'Claude' ? 'C' : 'X'}</div><div><div class="event-head"><strong>${item.actor}</strong><time>${item.time}</time></div><p>${escapeHtml(item.text)}</p></div></article>`;
}

function renderTimeline(target, limit) {
  let items = state?.timeline || [];
  if (actorFilter !== 'all') items = items.filter((item) => item.actor === actorFilter);
  if (limit) items = items.slice(-limit);
  $(target).innerHTML = items.length ? items.reverse().map(eventHtml).join('') : '<div class="empty">还没有协作记录</div>';
}

function renderTasks() {
  const items = state?.tasks || [];
  $('taskList').innerHTML = items.length ? items.map((task) => `
    <article class="task-item">
      <div class="task-id">${escapeHtml(task.id)}</div>
      <div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p><div class="task-meta"><span>${task.target === 'claude' ? 'Claude 总负责' : 'Codex 执行'}</span><span>${escapeHtml(task.priority)}</span>${task.scope ? `<span>${escapeHtml(task.scope)}</span>` : ''}</div></div>
      <span class="task-status ${task.status}">${task.status === 'running' ? '执行中' : (task.status === 'completed' ? '已完成' : '待启动')}</span>
    </article>`).join('') : '<div class="empty">任务板还是空的。点“布置任务”建立第一项任务。</div>';
}

function render() {
  const { progress, log } = state;
  const buttonTotal = progress.buttonsCorrectedTotal || progress.buttonsLegacyTotal;
  $('commit').textContent = `${state.branch} · ${state.commit}${state.dirtyFiles ? ` · ${state.dirtyFiles} 项未提交` : ''}`;
  $('liveBadge').textContent = state.activeTask ? `${state.activeTask.target === 'claude' ? 'Claude' : 'Codex'} 正在执行` : (state.active ? 'Codex 正在执行' : '等待下一项任务');
  $('liveBadge').classList.toggle('live', state.active);
  $('cellsMetric').textContent = `${progress.cellsDone} / ${progress.cellsTotal}`;
  $('cellsBar').style.width = `${Math.min(100, progress.cellsDone / progress.cellsTotal * 100)}%`;
  $('buttonsMetric').textContent = `${progress.buttonsDone} / ${buttonTotal || '—'}`;
  $('buttonsBar').style.width = `${buttonTotal ? Math.min(100, progress.buttonsDone / buttonTotal * 100) : 0}%`;
  $('buttonBasis').textContent = progress.buttonsCorrectedTotal ? `纠偏后共 ${progress.buttonsCorrectedTotal} 个入口模板` : '等待纠偏清单';
  $('claudeConnection').textContent = state.connections.claudeInstalled ? `Claude：${state.connections.claudeSessionReady ? '长期会话已建立' : '已安装，首次启动时建会话'}` : 'Claude：未安装';
  $('codexConnection').textContent = state.connections.codexInstalled ? 'Codex：已安装并可派发' : 'Codex：未安装';
  const waitingForReview = !state.active && state.latest?.actor === 'Codex' && state.latest?.kind === 'complete';
  const activeOwner = state.activeTask?.target === 'claude' ? 'Claude' : 'Codex';
  $('ownerMetric').textContent = state.active ? activeOwner : (waitingForReview ? 'Claude' : (state.latest?.actor || '—'));
  $('ownerDetail').textContent = state.activeTask ? `正在执行：${state.activeTask.title}` : (state.active ? '正在执行 Claude 派发的任务' : (waitingForReview ? 'Codex 已交付，等待 Claude 复验' : (state.latest?.text || '等待协作记录')));
  $('blockedMetric').textContent = state.blocked ? '1 项' : '0 项';
  $('blockedDetail').textContent = state.blocked?.text || '当前没有未处理卡点';
  $('tokenEstimate').textContent = log.estimatedTokens.toLocaleString();
  $('logUpdated').textContent = log.updatedAt ? `更新于 ${new Date(log.updatedAt).toLocaleTimeString('zh-CN')}` : '暂无日志';
  $('logViewer').textContent = log.lines.join('\n') || '还没有 Codex 执行日志。';
  renderTimeline('timelineList', 8);
  renderTimeline('fullTimeline');
  renderTasks();
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    state = await response.json();
    render();
  } catch (error) {
    $('liveBadge').textContent = '连接中断';
    $('liveBadge').classList.remove('live');
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item,.view').forEach((el) => el.classList.remove('active'));
  button.classList.add('active');
  $(button.dataset.view).classList.add('active');
}));
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((el) => el.classList.remove('active'));
  button.classList.add('active'); actorFilter = button.dataset.actor; renderTimeline('fullTimeline');
}));
$('refresh').addEventListener('click', refresh);
const dialog = $('taskDialog');
const openDialog = () => { $('taskError').textContent = ''; dialog.showModal(); };
const closeDialog = () => dialog.close();
$('newTask').addEventListener('click', openDialog);
document.querySelectorAll('.open-task').forEach((button) => button.addEventListener('click', openDialog));
$('closeTask').addEventListener('click', closeDialog);
$('cancelTask').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
$('taskForm').elements.runNow.addEventListener('change', (event) => {
  $('taskForm').querySelector('[type="submit"]').textContent = event.target.checked ? '立即启动' : '加入任务板';
});
$('taskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const runNow = form.get('runNow') === 'on';
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true; submit.textContent = runNow ? '正在启动…' : '正在保存…';
  try {
    const response = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form.entries())) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '创建任务失败');
    closeDialog(); event.currentTarget.reset();
    $('toast').textContent = runNow ? `任务 ${result.id} 已启动` : `任务 ${result.id} 已加入任务板`;
    $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 2600);
    await refresh();
    document.querySelector('[data-view="tasks"]').click();
  } catch (error) { $('taskError').textContent = error.message; }
  finally { submit.disabled = false; submit.textContent = '加入任务板'; }
});
refresh();
setInterval(refresh, 3000);
