import React from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';

/**
 * 「样例」行 —— 给新手引导一个能指的东西。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────
 *
 * 2026-09-07 金恩来：「引导的卡片做了也几乎等于白做，
 * 没有内容谁会看？看了谁又能记得住？」
 *
 * 说的是实情：新人第一次进来，线索、项目、不符合项全是空的。
 * 引导说「点开一个项目，里面是任务清单」——**根本没有项目可点**，
 * 他只能看着一片空白想象一遍，转头就忘。
 *
 * 对着一条具体的东西讲才记得住：
 * 「你看这一行，客户名在这儿、下一步要做什么在这儿、
 * 红色的是已经逾期的」。
 *
 * ── 为什么不写进数据库 ────────────────────────────────────────
 *
 * 写进去的话，在制项目数、本月签约金额、回款率全都会带上假数据。
 * 而这些数字正是用来判断「现在忙不忙、钱回来没有」的 ——
 * 跟历史合同顺手建僵尸项目是同一个坑，只是这次是我自己挖的。
 *
 * 所以它只是**渲染出来的一行**：按引导或空列表状态显示，不进任何统计，
 * 也不需要谁事后去清理。
 *
 * ── 什么时候出现 ──────────────────────────────────────────────
 *
 * 1）引导进行中 —— 引导要指着它讲
 * 2）这个列表本来就是空的 —— 新人第一次进来正是这种情况，
 *    与其给他一片空白，不如给他一个「长这样」
 *
 * 列表里已经有真数据、又不在引导中时不显示：
 * 那时候他要看的是自己的活，样例只会碍事。
 */

export const SampleRow: React.FC<{
  /** 这个列表现在是不是空的 */
  empty?: boolean;
  /** 一句话说明这条样例在演示什么 */
  caption?: string;
  /** 样例长什么样，由各页面自己给 —— 它得像那一页真实的行 */
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}> = ({ empty = false, caption, children, className = '', contentClassName = 'px-4 pt-4 pb-3' }) => {
  const { isTourActive } = useApp();
  if (!isTourActive && !empty) return null;

  return (
    <div
      data-sample="1" data-onboard="sample-record"
      onClickCapture={e => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDownCapture={e => { if (e.key !== 'Tab') { e.preventDefault(); e.stopPropagation(); } }}
      className={`relative rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}
    >
      {/*
        标签要压在边框上、而且是暖色。

        新人分不清「这是系统给我看的例子」还是「这是我的一条数据」，
        分不清的后果是他会去改它、删它，然后发现改不动 ——
        那一刻他对系统的信任就没了。所以标得越明确越好。
      */}
      <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 ring-1 ring-amber-300">
        <Sparkles className="w-3 h-3" />
        样例 · 不是真实数据
      </span>
      <div className={contentClassName}>{children}</div>
      {caption && (
        <p data-sample-caption="1" className="border-t border-gray-100 px-4 py-2 text-[11px] font-bold leading-relaxed text-gray-500">
          {caption.replace(/\*\*/g, '')}
        </p>
      )}
    </div>
  );
};

export default SampleRow;

/**
 * 表格里的样例行。
 *
 * 列表页多半是 `<table>`，往 tbody 里塞一个 `<div>` 浏览器会把它踢出表格，
 * 于是样例飘在表格外面、列也对不齐 —— 看起来就像个 bug。
 * 所以表格用这个版本，它本身就是一个 `<tr>`。
 */
export const SampleTr: React.FC<{
  empty?: boolean;
  /** 有几列，用来撑满说明那一行 */
  colSpan: number;
  caption?: string;
  children: React.ReactNode;
}> = ({ empty = false, colSpan, caption, children }) => {
  const { isTourActive } = useApp();
  if (!isTourActive && !empty) return null;

  return (
    <>
      <tr data-sample="1" data-onboard="sample-record" onClickCapture={e => { e.preventDefault(); e.stopPropagation(); }} className="bg-white hover:bg-gray-50/80">
        {children}
      </tr>
      <tr data-sample-caption="1" className="bg-white">
        <td colSpan={colSpan} className="px-4 pb-2.5 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 ring-1 ring-amber-300">
              <Sparkles className="w-3 h-3" />
              样例 · 不是真实数据
            </span>
            {caption && (
              <span className="text-[11px] font-bold text-gray-500">{caption.replace(/\*\*/g, '')}</span>
            )}
          </div>
        </td>
      </tr>
    </>
  );
};

/** 只给渲染列表加演示记录，复用真实卡片；原始数组仍用于统计、导出与保存。 */
export function SampleList<T>({ items, sample, render }: {
  items: T[]; sample: T; render: (item: T, index: number) => React.ReactElement;
}) {
  const { isTourActive } = useApp();
  const showSample = isTourActive || items.length === 0;
  return <>{(showSample ? [sample, ...items] : items).map((item, index) => {
    const element = render(item, index);
    const key = element.key ?? (item as {id?: string}).id ?? index;
    if (item !== sample) return React.cloneElement(element, {key});
    const decorate = (element: React.ReactElement<any>): React.ReactElement => {
    if (element.type === React.Fragment) return React.cloneElement(element, {}, React.Children.map(element.props.children, child => React.isValidElement(child) ? decorate(child) : child));
    const badge = <span className="mb-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">样例 · 不是真实数据</span>;
    const sampleChildren = element.type === 'tr'
      ? element.props.children
      : <>{badge}{element.props.children}</>;
    const decorated = React.cloneElement(element, {
      key, 'data-sample': '1', 'data-onboard': 'sample-record',
      className: `${element.props.className || ''} relative`,
      onClickCapture: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
      onKeyDownCapture: (e: React.KeyboardEvent) => { if (e.key !== 'Tab') { e.preventDefault(); e.stopPropagation(); } },
      children: sampleChildren,
    });
    if (element.type === 'tr') return <React.Fragment key={key}>{decorated}<tr data-sample-caption="1"><td colSpan={React.Children.toArray(element.props.children).length} className="px-4 py-1 border-b border-gray-100">{badge}</td></tr></React.Fragment>;
    return decorated;
    };
    return decorate(element);
  })}</>;
}
