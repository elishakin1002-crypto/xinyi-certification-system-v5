// 边界输入：不报错但存错，才是最危险的那一类。
//
// ── 实测（2026-09-18 边界输入那一轮）────────────────────────────
//
// 这三条以前全都放行：
//   · projectAmount: -5000  → HTTP 201，库里存成 -500000 分
//     **负数项目金额会直接污染营收、回款率、人均产值，而且不报错**
//   · projectAmount: 9e15   → HTTP 201
//     ×100 存「分」之后超出 JS 安全整数范围（MAX_SAFE_INTEGER ≈ 9.007e15），
//     存进去那一刻算术就已经不准了，后面每次加减都在放大误差
//   · deadline: '不是日期'   → HTTP **500**
//     而这个项目自己写过：500 是「服务端崩了」，400 才是「你传的不对」。
//     500 意味着未捕获异常，可能已经写了半截数据
//     （这次实测没写半截，但状态码在撒谎）
//
// 同时验**正常值不许被误伤** —— 收紧校验最容易干的蠢事就是把合法流程堵死。
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
const post = async (baseUrl, body) => {
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('金额不许是负数、不许超出可精确表示的范围', async () => {
  const { child, baseUrl } = await startServerProcess({ STATE_STORE_PATH: emptyStatePath('xinyi-edge') });
  try {
    const 负 = await post(baseUrl, { name: 'UAT边界-负金额', manager: '张三', projectAmount: -5000 });
    assert.equal(负.status, 400, '负数金额被收下了 —— 它会算进营收和回款率，而且不报错');
    assert.match(String(负.body?.message || ''), /负数/, '报错要说清是负数的问题');

    const 巨 = await post(baseUrl, { name: 'UAT边界-超大', manager: '张三', projectAmount: 9e15 });
    assert.equal(巨.status, 400, '×100 之后超出安全整数范围，存进去就已经不准了');

    const 非数 = await post(baseUrl, { name: 'UAT边界-非数字', manager: '张三', projectAmount: 'abc' });
    assert.equal(非数.status, 400, "'abc' 以前被静默存成 0 —— 调用方以为自己传对了");

    // ── 正常值不许被误伤 ────────────────────────────────────
    const 零 = await post(baseUrl, { name: 'UAT边界-零', manager: '张三', projectAmount: 0 });
    assert.equal(零.status, 201, '0 是合法的（还没填金额），不能堵死');
    const 小数 = await post(baseUrl, { name: 'UAT边界-小数', manager: '张三', projectAmount: 1234.56 });
    assert.equal(小数.status, 201, '1234.56 元 = 123456 分，合法');
    const 不传 = await post(baseUrl, { name: 'UAT边界-不传金额', manager: '张三' });
    assert.equal(不传.status, 201, '不传金额是合法用法 —— 先建项目再补金额');
  } finally { await stopServerProcess(child); }
});

test('非法日期要 400，不能炸成 500', async () => {
  const { child, baseUrl } = await startServerProcess({ STATE_STORE_PATH: emptyStatePath('xinyi-edge2') });
  try {
    for (const 坏日期 of ['不是日期', '2026/13/45', '20260930']) {
      const r = await post(baseUrl, { name: `UAT边界-${坏日期}`, manager: '张三', deadline: 坏日期 });
      assert.equal(r.status, 400,
        `deadline='${坏日期}' 返回的是 ${r.status}。500 意味着服务端崩了、可能写了半截数据；`
        + '这是"你传的不对"，该 400 并说清要什么格式');
      assert.match(String(r.body?.message || ''), /2026-09-30|年-月-日|格式/,
        '报错要告诉人该填什么格式，不能只说"不对"');
    }
    const 好 = await post(baseUrl, { name: 'UAT边界-好日期', manager: '张三', deadline: '2026-12-31' });
    assert.equal(好.status, 201, '正常日期不许被误伤');
    const 空 = await post(baseUrl, { name: 'UAT边界-空日期', manager: '张三', deadline: '' });
    assert.equal(空.status, 201, '不填交期是合法的');
  } finally { await stopServerProcess(child); }
});

test('特殊字符要原样存下来 —— 不许偷偷改掉客户填的名字', async () => {
  /*
    引号、逗号、尖括号、换行、emoji 都必须原样存。
    偷偷转义或截断的后果是：人填的名字和系统里的对不上，查重查不到，
    而且没人知道系统改过它。
    （XSS 由 React 渲染时转义负责，不该在存储层做。）
  */
  const { child, baseUrl } = await startServerProcess({ STATE_STORE_PATH: emptyStatePath('xinyi-edge3') });
  try {
    for (const 名 of ['他说"你好"公司', '甲,乙,丙公司', '<script>alert(1)</script>', '第一行\n第二行', '公司🎉']) {
      const r = await post(baseUrl, { name: 名, manager: '张三' });
      assert.equal(r.status, 201);
      assert.equal(r.body?.data?.project?.name, 名, `「${名.slice(0,12)}」被改动了 —— 人填的和存的对不上`);
    }
  } finally { await stopServerProcess(child); }
});
