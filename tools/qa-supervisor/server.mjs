import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const publicDir = path.join(here, 'public');
const port = Number(process.env.QA_SUPERVISOR_PORT || 4176);
const host = '127.0.0.1';
const runtimeDir = path.join(root, '.runtime/qa-supervisor');
const taskFile = path.join(runtimeDir, 'tasks.json');
const claudeSessionFile = path.join(runtimeDir, 'claude-session-id');
fs.mkdirSync(runtimeDir, { recursive: true });

const read = (file, fallback = '') => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
};

const redact = (value) => value
  .replace(/(password|密码|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]')
  .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[已隐藏的密钥]');

function git(...args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function parseJournal() {
  const raw = read(path.join(root, 'docs/协作日志.md'));
  return raw.split('\n').flatMap((line, index) => {
    const match = line.match(/^-\s+(\d{2}:\d{2})\s+(Claude|Codex)：(.+)$/);
    if (!match) return [];
    const [, time, actor, text] = match;
    const lower = text.toLowerCase();
    let kind = 'update';
    if (/派活|交给|任务/.test(text)) kind = 'dispatch';
    if (/卡点|失败|拒绝|不能|无法|驳回/.test(text)) kind = 'blocked';
    if (/完成|通过|修复|结论|跑完/.test(text)) kind = 'complete';
    return [{ id: `journal-${index}`, time, actor, text: redact(text), kind }];
  });
}

function latestLog() {
  const link = path.join(root, '.runtime/codex-logs/latest.log');
  const raw = redact(read(link));
  const lines = raw.split('\n').filter(Boolean);
  return {
    exists: Boolean(raw),
    lines: lines.slice(-220),
    charCount: raw.length,
    estimatedTokens: Math.round(raw.length / 4),
    updatedAt: (() => { try { return fs.statSync(link).mtime.toISOString(); } catch { return null; } })(),
  };
}

function reportProgress() {
  const report = read(path.join(root, 'docs/逐页清点报告.md'));
  const cells = report.match(/85\s*个格子测了\s*(\d+)\s*个/);
  const oldButtons = report.match(/357\s*条文案核了\s*(\d+)\s*条/);
  const corrected = read(path.join(root, 'docs/可点元素清单.md')).match(/总数：\s*(\d+)\s*条/);
  return {
    cellsDone: Number(cells?.[1] || 0),
    cellsTotal: 85,
    buttonsDone: Number(oldButtons?.[1] || 0),
    buttonsLegacyTotal: 357,
    buttonsCorrectedTotal: Number(corrected?.[1] || 0),
  };
}

/**
 * 从任务日志里读出它到底成没成。
 *
 * ── 为什么要有这个（2026-09-16）────────────────────────────────
 *
 * 原来判「完成」只看进程还在不在：`process.kill(pid, 0)` 抛异常就标已完成。
 * **进程退出 ≠ 任务完成。**
 *
 * 金总当天派了两条任务，面板都显示「已完成」，但一行代码没改、
 * git 没有新提交。翻日志才看到：
 *     "error":"authentication_failed"
 *     "OAuth access token has been revoked"
 * 两个后台 Claude 会话登录失效，5 秒就退出了，什么都没做。
 *
 * 而且日志最后那行本身就有坑：
 *     {"subtype":"success", "is_error":true, "api_error_status":401}
 * **subtype 写着 success，is_error 是 true** —— 只看 subtype 就会误判。
 *
 * 这正是这个项目反复踩的形状：**显示的是标志位，不是事实**。
 * 一个会把失败报成成功的监督台，比没有监督台更糟 ——
 * 人会以为活干完了，直到上线那天才发现没有。
 */
function readTaskOutcome(taskId) {
  const logPath = path.join(runtimeDir, `${taskId}.log`);
  const raw = read(logPath, '');
  if (!raw.trim()) return { ok: false, reason: '没有任何输出，多半是根本没起来' };

  // Claude 的 stream-json：最后一条 type=result 才是结论
  let last = null;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { const o = JSON.parse(t); if (o.type === 'result') last = o; } catch { /* 半行/非 JSON，跳过 */ }
  }
  if (last) {
    if (last.is_error || last.api_error_status) {
      return { ok: false, reason: String(last.result || `接口返回 ${last.api_error_status}`).slice(0, 300) };
    }
    return { ok: true, reason: String(last.result || '').slice(0, 300) };
  }

  // Codex 走的是 codex-run.sh，纯文本日志：认里面的 ERROR / 退出码
  if (/^ERROR:/m.test(raw)) return { ok: false, reason: (raw.match(/^ERROR:.*/m) || [''])[0].slice(0, 300) };
  if (/跑完（退出码 0）/.test(raw)) return { ok: true, reason: '' };
  if (/跑完（退出码 [1-9]/.test(raw)) return { ok: false, reason: (raw.match(/跑完（退出码 \d+）/) || [''])[0] };

  return { ok: false, reason: '日志里没有可判定的结论 —— 当作没完成，别猜' };
}

function tasks() {
  try {
    const items = JSON.parse(read(taskFile, '[]'));
    let changed = false;
    for (const item of items) {
      if (item.status !== 'running' || !item.pid) continue;
      try { process.kill(item.pid, 0); }
      catch {
        // 进程没了只说明"跑完了"，成没成要去日志里看
        const outcome = readTaskOutcome(item.id);
        item.status = outcome.ok ? 'completed' : 'failed';
        item.failureReason = outcome.ok ? undefined : outcome.reason;
        item.completedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveTasks(items);
    return items;
  } catch { return []; }
}

function saveTasks(items) {
  fs.writeFileSync(taskFile, `${JSON.stringify(items, null, 2)}\n`);
}

function taskPrompt(task) {
  return `# 监督台任务：${task.title}\n\n` +
    `- 发起人：金总\n- 负责人：${task.target === 'claude' ? 'Claude 总负责人' : 'Codex 执行员'}\n` +
    `- 优先级：${task.priority}\n- 角色/页面：${task.scope || '未指定'}\n\n` +
    `## 要做什么\n${task.description}\n\n## 验收标准\n${task.acceptance}\n\n` +
    `## 固定要求\n每完成一段就在 docs/协作日志.md 追加一句中文进度；不要输出或记录密码、密钥；不删除非 UAT 数据；发现需要越权或不可逆操作时停止并记录卡点。\n`;
}

function dispatchTask(task) {
  const promptPath = path.join(runtimeDir, `${task.id}.md`);
  const outputPath = path.join(runtimeDir, `${task.id}.log`);
  fs.writeFileSync(promptPath, taskPrompt(task));
  const output = fs.openSync(outputPath, 'a');
  const command = task.target === 'codex' ? 'bash' : 'claude';
  let args;
  if (task.target === 'codex') {
    args = [path.join(root, 'scripts/codex-run.sh'), promptPath];
  } else {
    const existingSession = read(claudeSessionFile).trim();
    const sessionId = existingSession || randomUUID();
    if (!existingSession) fs.writeFileSync(claudeSessionFile, `${sessionId}\n`);
    args = ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--name', '信义-QA-总负责人'];
    args.push(existingSession ? '--resume' : '--session-id', sessionId, taskPrompt(task));
  }
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', output, output], env: process.env });
  child.unref();
  fs.closeSync(output);
  return { pid: child.pid, outputPath: path.relative(root, outputPath) };
}

async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw new Error('任务内容太长');
  }
  return JSON.parse(body || '{}');
}

function state() {
  const timeline = parseJournal();
  const log = latestLog();
  const taskItems = tasks();
  const activeTask = taskItems.find((item) => item.status === 'running') || null;
  const lastBlockedIndex = timeline.findLastIndex((item) => item.kind === 'blocked');
  const lastCompleteIndex = timeline.findLastIndex((item) => item.kind === 'complete');
  const blocked = lastBlockedIndex > lastCompleteIndex ? timeline[lastBlockedIndex] : null;
  const latest = timeline.at(-1);
  return {
    generatedAt: new Date().toISOString(),
    repository: path.basename(root),
    branch: git('branch', '--show-current') || 'detached',
    commit: git('rev-parse', '--short', 'HEAD'),
    dirtyFiles: git('status', '--short').split('\n').filter(Boolean).length,
    active: Boolean(activeTask || (log.updatedAt && Date.now() - Date.parse(log.updatedAt) < 90_000)),
    activeTask,
    connections: {
      claudeInstalled: Boolean(process.env.PATH?.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, 'claude')))),
      claudeSessionReady: Boolean(read(claudeSessionFile).trim()),
      codexInstalled: Boolean(process.env.PATH?.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, 'codex')))),
    },
    latest,
    blocked,
    timeline,
    log,
    tasks: taskItems,
    progress: reportProgress(),
  };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(state()));
    return;
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    jsonBody(req).then((input) => {
      const title = String(input.title || '').trim();
      const description = String(input.description || '').trim();
      const acceptance = String(input.acceptance || '').trim();
      if (!title || !description || !acceptance) throw new Error('任务、说明和验收标准都要填写');
      if (!['claude', 'codex'].includes(input.target)) throw new Error('负责人不正确');
      if (input.runNow && tasks().some((task) => task.status === 'running' && task.target === input.target)) {
        throw new Error(`${input.target === 'claude' ? 'Claude' : 'Codex'} 还有任务正在执行，请等它完成后再启动下一项`);
      }
      const item = {
        id: `T-${Date.now().toString(36).toUpperCase()}`,
        title: redact(title), description: redact(description), acceptance: redact(acceptance),
        scope: redact(String(input.scope || '').trim()), target: input.target,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(input.priority) ? input.priority : 'P2',
        status: input.runNow ? 'running' : 'queued', createdAt: new Date().toISOString(), runNow: Boolean(input.runNow),
      };
      if (item.runNow) Object.assign(item, dispatchTask(item));
      const items = tasks(); items.unshift(item); saveTasks(items.slice(0, 100));
      res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(item));
    }).catch((error) => {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message || '创建任务失败' }));
    });
    return;
  }
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(publicDir, requested);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`监督面板已启动：http://${host}:${port}`);
  console.log('只监听本机，不会把协作日志暴露到外网。');
});
