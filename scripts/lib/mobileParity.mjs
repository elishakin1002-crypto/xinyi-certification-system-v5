/*
  桌面分支 / 手机分支 的能力对比。

  ══════════════════════════════════════════════════════════════
  为什么需要它（2026-09-20）
  ══════════════════════════════════════════════════════════════

  金恩来：「手机尺寸下，合同管理中合同详情的在线阅览、已收款报备选项
    都不见了……这类 BUG 系统里应该还有不少，为什么你之前大检查的时候
    没有检查出来？」

  真因是结构性的：这个项目有 10 个文件用
    `hidden md:block` / `md:hidden`
  渲染**两套完全独立的界面**。我之前那次「按钮清点」跑在桌面宽度下，
  物理上看不到手机分支里有什么、少什么 —— 不是我漏了，
  是那种检查方式从原理上就覆盖不到一半的界面。

  合同页实测的差异（两边**各有**对方没有的东西，不是简单的子集）：
    桌面有手机没有：预览、下载、回款计划（报备已收款在里面）、电子档案柜
    手机有桌面没有：为合同立项

  ── 怎么比 ────────────────────────────────────────────────────

  比**动作**，不比文案。动作 = onClick/onChange 里调的那个函数名。
  文案两边本来就该不一样（手机要短），而"能不能做这件事"必须一样。

  这是静态扫描，抓不到「点了没反应」那种（合同手机卡片就是：
  onClick 调了 toggleExpand，但展开的内容只在桌面表格里渲染）。
  那一类要靠 e2e 在 375px 下真的点 —— 两种手段各管一段，都要有。
*/
import fs from 'node:fs';

/**
 * 从一段源码里，按 JSX 结构截出以 `startIdx` 处的 `<div` 开头的那个元素。
 *
 * 不用正则匹配嵌套 —— 正则做不了。数 `<div` 和 `</div>` 的深度。
 * 自闭合的 `<div ... />` 也要算（这个项目里少见但有）。
 */
const sliceElement = (src, startIdx) => {
  /*
    标签名不能写死成 div。

    第一版我只数 `<div>`，于是 components/Layout.tsx 里那个
    `<header className="hidden md:flex">` 根本没被正确截取 ——
    结果把「全局搜索只有桌面有」报成了「只有手机有」，**正好反了**。

    一个用来查不一致的工具，自己先给出了不一致的结论。
    所以现在按实际开标签的名字来数。
  */
  const tagMatch = /^<([a-zA-Z][\w.-]*)/.exec(src.slice(startIdx, startIdx + 40));
  if (!tagMatch) return '';
  const tag = tagMatch[1];
  const open = `<${tag}`;
  const close = `</${tag}>`;

  let i = startIdx;
  let depth = 0;
  while (i < src.length) {
    if (src.startsWith(open, i) && /[\s/>]/.test(src[i + open.length] || '')) {
      const end = src.indexOf('>', i);
      if (end === -1) break;
      if (src[end - 1] !== '/') depth += 1;
      i = end + 1;
      continue;
    }
    if (src.startsWith(close, i)) {
      depth -= 1;
      i += close.length;
      if (depth === 0) return src.slice(startIdx, i);
      continue;
    }
    i += 1;
  }
  return src.slice(startIdx);
};

/** 从 className 的位置往前找到它所属的那个开标签 */
const openingTagBefore = (src, idx) => {
  for (let i = idx; i >= 0; i -= 1) {
    if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] || '')) return i;
  }
  return -1;
};

/** 一段源码里所有「动作」——onClick / onChange 里调到的函数名 */
const actionsIn = (chunk) => {
  const out = new Set();
  for (const m of chunk.matchAll(/on(?:Click|Change|Submit)=\{\s*(?:\([^)]*\)\s*=>\s*)?([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    // 过滤掉 setXxx 这类纯本地状态和一看就不是业务动作的
    if (/^(?:e|event|_)$/.test(name)) continue;
    out.add(name);
  }
  return out;
};

const DESKTOP_RE = /className=["'`][^"'`]*\bhidden\s+(?:md|lg):(?:block|flex|grid|table|inline-flex)\b/g;
const MOBILE_RE = /className=["'`][^"'`]*\b(?:md|lg):hidden\b/g;

/** 把一个文件里所有桌面段、手机段的动作各汇总成一个集合 */
export const parityOf = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const collect = (re) => {
    const acts = new Set();
    for (const m of src.matchAll(re)) {
      const start = openingTagBefore(src, m.index);
      if (start === -1) continue;
      for (const a of actionsIn(sliceElement(src, start))) acts.add(a);
    }
    return acts;
  };
  const desktop = collect(DESKTOP_RE);
  const mobile = collect(MOBILE_RE);
  return {
    file,
    desktop,
    mobile,
    /** 桌面能做、手机做不了 —— 这一类是金恩来报的那种 */
    desktopOnly: [...desktop].filter((a) => !mobile.has(a)).sort(),
    /** 手机能做、桌面做不了 —— 同样是不一致，只是没人在手机上办公所以没人报 */
    mobileOnly: [...mobile].filter((a) => !desktop.has(a)).sort()
  };
};

export const FILES_WITH_BOTH = (dirs, walk) =>
  dirs.flatMap(walk).filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /\bhidden\s+(?:md|lg):/.test(src) && /\b(?:md|lg):hidden\b/.test(src);
  });
