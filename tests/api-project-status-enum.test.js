// 接口不许收下一个不认识的项目状态。
//
// 2026-09-17 造验收样本时，我给 `POST /api/projects` 传了 `status: '进行中'`
// （中文，想当然以为服务端会规范化）。**它原样存进了库。**
//
// 后果不是报错，是更难发现的东西：
//   · 项目在列表里照常显示、能点开、能改
//   · 但项目管理四张卡每一张都判 `status !== 'Active'`，
//     于是它对四张卡**全部不可见** —— 进行中项目 0，而下面列着 8 行
//   · 状态列渲染原始字符串「进行中」，紧挨着真项目的「执行中」，
//     同一列两个词
//
// 也就是「存在、看得见、但不进任何统计」的项目。
// 和 2026-09-15 那条「任务状态被静默改回待处理」是同一个形状：
// **服务端不校验枚举，前端却按枚举算数。**
//
// 附带查出来的事：app.js:5059 也注册了 `POST /api/projects`，里面确实有
// normalizeProjectStatus —— 但 batch2 路由在 app.js:442 就挂上了，
// Express 先匹配先注册的，那段规范化**永远跑不到**。
// 所以校验必须加在真正在跑的那条路上（batch2），加在 app.js 里等于没加。
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
  const body = await res.json().catch(() => ({}));
  return { res, body };
};

test('项目状态不是枚举里的词，必须 400，不许悄悄存下来', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-project-status')
  });

  try {
    const 中文状态 = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UAT-状态枚举-中文', status: '进行中', manager: '张三' })
    });
    assert.equal(中文状态.res.status, 400,
      "'进行中' 被收下了 —— 这个项目会在列表里出现，却不进任何一张统计卡");
    assert.match(String(中文状态.body?.message || ''), /Active/,
      '报错要说清能填什么，不然调用方只能猜');

    const 乱码状态 = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UAT-状态枚举-乱码', status: 'ACTIVE', manager: '张三' })
    });
    assert.equal(乱码状态.res.status, 400, '大小写不同也是另一个词，一样不该收');

    // 别把正常路径也堵死：不传 status（走默认）和传 Active 都必须能建
    const 不传 = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UAT-状态枚举-不传状态', manager: '张三' })
    });
    assert.equal(不传.res.status, 201, '不传 status 是合法用法（服务端给默认 Active）');
    assert.equal(不传.body?.data?.project?.status, 'Active');

    const 传对的 = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UAT-状态枚举-Active', status: 'Active', manager: '张三' })
    });
    assert.equal(传对的.res.status, 201);

    // PATCH 也要拦 —— 否则先建对再改错，绕一步就进去了
    const id = 传对的.body?.data?.project?.id;
    const 改错 = await jsonFetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '已暂停' })
    });
    assert.equal(改错.res.status, 400, 'PATCH 没拦的话，建的时候拦了也白拦');
  } finally {
    await stopServerProcess(child);
  }
});
