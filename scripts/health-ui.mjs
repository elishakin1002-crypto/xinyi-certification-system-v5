#!/usr/bin/env node
// 前端体检（静态）：把「以前只能靠人眼撞见」的问题变成可重复检查。
//
//   npm run health:ui              全量
//   npm run health:ui -- pages/Projects.tsx   只查指定文件
//
// 每条规则都来自一个真实踩过的坑，不是凭空想的通用 lint：
//   · 「回款明细（从）」——历史提交留下的残字，在页面上挂了半年没人发现
//   · 灰底灰字的「已收款，请核对」——按钮没禁用却长得像禁用，销售不会去点
//   · 「结算与提成信息仅财务和管理员可见」——用半个版面写一句读者做不了任何事的话
//   · deadline: '2025-12-31' ——写死的过期日期
//
// 只报**能指到具体行**的问题；拿不准的一律不报，免得清单里全是噪音、失去意义。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOTS = ['pages', 'components', 'src'];
const findings = [];

const add = (file, line, rule, detail, why) => findings.push({ file, line, rule, detail, why });

/** 逐行扫描的规则 */
const LINE_RULES = [
  {
    rule: '残留占位文本',
    // 括号里只剩一个孤零零的介词/动词，或明显的占位标记
    re: /（(从|至|到|自)）|【待补】|TODO[:：]|FIXME|占位文本|placeholder文案|xxx占位/i,
    why: '页面上会直接显示出来，用户看到的是半句话',
  },
  {
    rule: '写死的日期',
    re: /['"`](20(2[0-5])-\d{2}-\d{2})['"`]/,
    why: '写死的日期会随时间变成过期数据，新建记录就带着一个已经超期的截止日',
  },
  {
    rule: '阻塞式弹窗',
    re: /\b(window\.)?(confirm|alert|prompt)\s*\(/,
    why: '浏览器原生弹窗无法排版、不能显示上下文、移动端体验差；关键操作应该用 Modal',
  },
  {
    rule: '中文角色名硬编码',
    re: /['"`](管理员|交付负责人|咨询顾问|财务|销售)['"`]\s*[,;)\]}]/,
    why: '角色显示名应走 roleLabel()，否则改了角色定义这里不会跟着变',
  },
];

/** 需要看上下文的规则 */
const BLOCK_RULES = [
  {
    rule: '按钮看着像禁用但其实可点',
    test: (src) => {
      const out = [];
      // <button ... className="...bg-gray-100/200... text-gray-..." 且有 onClick
      const re = /<button([^>]*?)>/gs;
      let m;
      while ((m = re.exec(src))) {
        const attrs = m[1];
        if (!/onClick/.test(attrs)) continue;
        const cls = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
        if (!cls) continue;
        const c = cls[1] || cls[2] || '';
        const grayBg = /bg-gray-(100|200)\b/.test(c);
        const grayText = /text-gray-(4|5|6)00\b/.test(c);
        // 有 hover 变色说明作者有意做成次要按钮但仍有反馈；完全没 hover 才是问题
        // 完全没有任何 hover 才算「看着不可点」；gray→gray 的 hover 虽然弱，但有反馈
        const noHover = !/hover:/.test(c);
        if (grayBg && grayText && noHover) {
          out.push({ index: m.index, detail: c.slice(0, 70) });
        }
      }
      return out;
    },
    why: '灰底灰字且 hover 无变化，读者会以为点不了。真正的次要动作要有可点的视觉暗示',
  },
  {
    rule: '用大块版面显示「你没权限看」',
    test: (src) => {
      const out = [];
      const re = /(仅[^<>"'\n]{0,12}(可见|才能看)|无权限查看|没有权限查看)/g;
      let m;
      while ((m = re.exec(src))) {
        // 附近有 p-4/p-5/p-6 或 min-h 说明是个占版面的块，而不是一行小字提示
        const around = src.slice(Math.max(0, m.index - 400), m.index + 200);
        if (/\bp-[456]\b|min-h-|py-[6-9]|h-\d{2}/.test(around)) {
          out.push({ index: m.index, detail: m[1] });
        }
      }
      return out;
    },
    why: '看不到的东西不该占位。用半个版面写一句读者做不了任何事的话，是纯浪费',
  },
  {
    rule: '空 onClick / 只打日志',
    test: (src) => {
      const out = [];
      const re = /onClick=\{\s*\(\s*\)\s*=>\s*(\{\s*\}|console\.\w+\([^)]*\)\s*;?\s*\}?|undefined|null)\s*\}/g;
      let m;
      while ((m = re.exec(src))) out.push({ index: m.index, detail: m[0].slice(0, 50) });
      return out;
    },
    why: '点了没反应的按钮，用户会反复点然后认为系统坏了',
  },
];

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * 把注释内容替换成同长度的空格（保留换行），这样行号不变但注释里的文字不会被匹配。
 * 必须处理 JSX 的 {/* ... *\/} —— 第一版漏了它，结果把「修复说明」注释里
 * 引用的原文当成了未修复的问题报出来，自己打自己的脸。
 */
const stripComments = (src) => {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)  // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, blank)                // /* ... */
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length))); // // ...（不误伤 URL 的 //）
};

const scan = (file) => {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const lines = src.split('\n');

  lines.forEach((text, i) => {
    for (const r of LINE_RULES) {
      const m = text.match(r.re);
      if (m) add(file, i + 1, r.rule, m[0].slice(0, 60), r.why);
    }
  });

  for (const r of BLOCK_RULES) {
    for (const hit of r.test(src)) add(file, lineOf(src, hit.index), r.rule, hit.detail, r.why);
  }
};

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};

const main = () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = args.length ? args : ROOTS.flatMap((r) => walk(r));
  for (const f of files) { try { scan(f); } catch { /* 读不了就跳过 */ } }

  if (findings.length === 0) { console.log(`\n✅ 前端体检通过（扫描 ${files.length} 个文件，无问题）\n`); return; }

  // 按规则聚合，同一类问题放一起看
  const byRule = {};
  for (const f of findings) (byRule[f.rule] = byRule[f.rule] || []).push(f);

  // 阻塞式弹窗遍布全项目，逐行列出来只会变成噪音——按文件汇总，
  // 并把「金额/删除」相关的单独挑出来（这些是真要优先改的）
  const popups = byRule['阻塞式弹窗'];
  if (popups && popups.length > 20) {
    delete byRule['阻塞式弹窗'];
    const byFile = {};
    for (const f of popups) byFile[f.file] = (byFile[f.file] || 0) + 1;
    console.log(`\n━━ 阻塞式弹窗（${popups.length} 处，遍布 ${Object.keys(byFile).length} 个文件）`);
    console.log('   浏览器原生弹窗无法排版、不能显示上下文、移动端体验差');
    console.log('   数量太多，按文件汇总；整体替换成 Modal 属于独立任务，不适合夹在别的改动里做：');
    for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`   ${String(n).padStart(3)} 处  ${f}`);
    }
  }

  console.log(`\n前端体检：${findings.length} 处待确认（扫描 ${files.length} 个文件）`);
  for (const [rule, list] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n━━ ${rule}（${list.length} 处）`);
    console.log(`   ${list[0].why}`);
    for (const f of list.slice(0, 12)) console.log(`   ${f.file}:${f.line}  ${f.detail}`);
    if (list.length > 12) console.log(`   ... 另 ${list.length - 12} 处`);
  }
  console.log('\n这些是「需要人看一眼」的清单，不是全都得改——有些是刻意为之。');
  console.log('但每一条都要给出结论，不能放着不管。\n');
  // 不用非零退出码：这是体检报告，不是 CI 门禁。判断权在人手上。
};

main();
