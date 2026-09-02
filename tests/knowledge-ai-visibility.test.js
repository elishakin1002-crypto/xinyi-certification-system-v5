// AI 语料准入：什么文档配进 AI 的知识库。
//
// ── 为什么要管 ──────────────────────────────────────────────────
// 进语料的文档每次检索都要过一遍，token 按量算。
// 但花钱还不是最糟的——**污染**才是：
// 空白记录表单和体系文件范本在 100 家客户之间高度雷同，
// 它们会把真正有价值的客户复盘、不符合项整改经验从检索结果里挤下去，
// 于是 AI 答出来的东西越来越像模板，越来越没用。
//
// 2026-08-24 之前，知识中心上传表单的「让 AI 学习」是**默认勾上**的，
// 所以每一份传上去的文件都自动进语料。
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const tmp = (n) => path.join(os.tmpdir(), `${n}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
const env = (name) => {
  const f = tmp(name);
  fs.writeFileSync(f, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return { STATE_STORE_PATH: f };
};

const call = async (url, { method = 'GET', body } = {}) => {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, body: await res.json().catch(() => ({})) };
};

const longText = '这是一份真实的客户复盘文档。'.repeat(20);   // 远超 200 字

test('正文太短的文档，标了 AI 可见也不会真的进语料', async () => {
  const { child, baseUrl } = await startServerProcess(env('kb-guard'));
  try {
    const r = await call(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      body: { doc: { id: `DOC-SHORT-${Date.now()}`, title: '空白记录表单', category: 'Template',
                     content: '记录表', aiVisible: true } },
    });
    assert.equal(r.res.status, 201, `创建应成功：${JSON.stringify(r.body)}`);
    assert.equal(r.body.data.doc.aiVisible, false,
      '只有 3 个字的文档被放进了 AI 语料——它对检索毫无帮助，却每次都要花 token 过一遍');
  } finally {
    await stopServerProcess(child);
  }
});

test('正文充实的文档，标了 AI 可见就应当真的可见', async () => {
  const { child, baseUrl } = await startServerProcess(env('kb-allow'));
  try {
    const r = await call(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      body: { doc: { id: `DOC-LONG-${Date.now()}`, title: '客户复盘｜某某公司', category: 'PDCA',
                     content: longText, aiVisible: true } },
    });
    assert.equal(r.res.status, 201);
    assert.equal(r.body.data.doc.aiVisible, true,
      '拦截规则不能误伤真正有内容的文档——那样 AI 会变笨，不是变准');
  } finally {
    await stopServerProcess(child);
  }
});

test('修改文档时同样拦截：不能把充实文档改空后仍留在语料里', async () => {
  const { child, baseUrl } = await startServerProcess(env('kb-patch'));
  try {
    const id = `DOC-PATCH-${Date.now()}`;
    const created = await call(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      body: { doc: { id, title: '会变空的文档', category: 'Other', content: longText, aiVisible: true } },
    });
    assert.equal(created.body.data.doc.aiVisible, true);

    // 内容被清空后仍标 AI 可见 → 应当被拦下
    const patched = await call(`${baseUrl}/api/knowledge/${id}`, {
      method: 'PATCH', body: { doc: { content: '删了', aiVisible: true } },
    });
    assert.equal(patched.res.status, 200);
    assert.equal(patched.body.data.doc.aiVisible, false,
      '改空之后还留在语料里，等于一份「只有标题」的文档在参与检索');
  } finally {
    await stopServerProcess(child);
  }
});

test('上传表单的「让 AI 学习」默认不勾', () => {
  /*
    默认勾上的后果是：所有上传都进语料，包括范本和空白表单。
    默认不勾不是不信任 AI，是让「这份值得让 AI 学」变成一次明确的判断，
    而不是上传时顺手带过去的副作用。
  */
  const src = fs.readFileSync(path.resolve(__dirname, '../pages/Knowledge.tsx'), 'utf8');
  assert.match(src, /const \[aiVisible, setAiVisible\] = useState\(false\)/,
    '上传表单又把「让 AI 学习」默认勾上了');
});

test('系统自动生成的沉淀类文档仍然默认进语料', () => {
  /*
    客户复盘、不符合项整改经验、AI 交付物——这些是真实沉淀，
    正是最该让 AI 看到的东西。一刀切关掉会让 AI 变笨。
    这条用例守住的是「别把这几处也改成 false」。
  */
  const cp = fs.readFileSync(path.resolve(__dirname, '../server/services/completeProject.js'), 'utf8');
  assert.match(cp, /category: 'PDCA'[\s\S]{0,200}aiVisible: true/,
    '项目完成生成的客户复盘应当默认进语料——那是真实经营沉淀，不是模板');
});

test('复盘标题要带上标准号，否则搜不到', () => {
  /*
    实测：《客户复盘｜浙江博峰数字科技｜咨询服务合同书》，
    ISO14001/ISO45001 只出现在正文的回款明细里
    （「甲方收到 ISO14001/ISO45001 认证电子版证书时」）。

    标准是这行业最有区分度的检索词。服务项写成「咨询服务合同书」时，
    标题本身说明不了做的是什么体系——同事搜「ISO 14001 的复盘」只能靠正文命中，
    而正文在检索里权重最低。
  */
  /*
    断言的是**行为**，不是变量名。
    第一版写的是 /titleSuffix/——那是当时的局部变量名，
    后来标题拼装抽到共用模块 buildPdcaTitle，变量没了，测试就红了。
    测试盯着实现细节，重构一次就得改一次，久了没人愿意重构。
  */
  const src = fs.readFileSync(path.resolve(__dirname, '../server/services/completeProject.js'), 'utf8');
  assert.ok(/detectStandards/.test(src), '缺少标准识别');
  assert.ok(/buildPdcaTitle\(/.test(src), '标题没有走带标准号的拼装');
  assert.match(src, /trustLevel: 'ourExperience'/,
    '复盘要标成「我们的经验」——它不是标准原文，AI 引用时得说明出处');
});

test('复盘要带上关联客户的行业', () => {
  // 「食品厂做 SC 要注意什么」这类问法要靠行业维度才检索得准
  const src = fs.readFileSync(path.resolve(__dirname, '../server/services/completeProject.js'), 'utf8');
  assert.match(src, /industry: customer\.industry/, '复盘没带行业标签');
});
