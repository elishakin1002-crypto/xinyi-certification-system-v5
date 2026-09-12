import React, { useMemo, useRef, useState } from 'react';
import { Search, X, Plus, Sparkles } from 'lucide-react';
import { SERVICE_CATALOG } from '../constants';
import { searchCatalog, matchCatalogItems, toServiceLine } from '../src/modules/serviceCatalogMatch';
import type { ServiceCatalogItem } from '../types';

/**
 * 服务项目选择器 —— 从 111 条标准目录里多选。
 *
 * ── 为什么不是自由文本（2026-09-12）────────────────────────────
 *
 * 金恩来：「目前的合同不够规范，同时识别 pdf 也常常不够准确，
 * 这里还是需要，提供标准的服务项目多选会更准确，高效」。
 *
 * 原来这里是一个 `<input>`。后果在别的地方才显形：
 *   · 10 份合同 10 种写法，「这家做过哪些体系」查不出来
 *   · 一份合同做两项服务，存成一句话，拆不开、算不出各自工作量
 *   · 派活建议、流程模板都要靠猜服务类型 —— 猜错就派错人
 *
 * ── 为什么不是单选下拉 ────────────────────────────────────────
 *
 * 一份合同同时做 9001 + 14001 + 45001 是常态（就叫"三体系"）。
 * 单选会逼人挑一个、把另外两个丢掉，或者退回去写自由文本。
 *
 * ── 为什么留了「目录里没有」这个口子 ──────────────────────────
 *
 * 111 条覆盖不了全部，尤其是第三方合作的新业务。
 * 堵死会让人为了录进系统而硬选一个不对的 —— 那比自由文本还糟，
 * 因为错误数据看起来是规范的。所以留口子，但**标出来**，
 * 让它显眼到「要么补进目录、要么改写法」。
 */
export const ServicePicker: React.FC<{
  /** 存进合同的那串字（标准名，顿号分隔） */
  value: string;
  onChange: (next: string) => void;
  /** AI 从合同里读到的原话 —— 摆出来对照，别让人猜系统是怎么勾的 */
  aiRawText?: string;
}> = ({ value, onChange, aiRawText }) => {
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  /*
    已选 = 把 value 那串字反解回来。
    存的是标准名而不是 id：合同的 serviceLine 一直是字符串，
    改成存 id 要动库结构和所有读它的地方；而名字既然来自固定目录，
    就已经是规范值了 —— 这一步的目的本来就是「让写法统一」。
  */
  const selectedNames = useMemo(
    () => String(value || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean),
    [value]
  );
  const catalogByName = useMemo(() => {
    const m = new Map<string, ServiceCatalogItem>();
    SERVICE_CATALOG.forEach(i => m.set(i.name, i));
    return m;
  }, []);

  const results = useMemo(() => searchCatalog(keyword).slice(0, 60), [keyword]);
  const grouped = useMemo(() => {
    const g = new Map<string, ServiceCatalogItem[]>();
    results.forEach(i => g.set(i.category, [...(g.get(i.category) || []), i]));
    return Array.from(g.entries());
  }, [results]);

  const toggle = (name: string) => {
    const has = selectedNames.includes(name);
    const next = has ? selectedNames.filter(n => n !== name) : [...selectedNames, name];
    onChange(next.join('、'));
  };

  const addCustom = () => {
    const t = customDraft.trim();
    if (!t || selectedNames.includes(t)) return;
    onChange([...selectedNames, t].join('、'));
    setCustomDraft('');
  };

  /** AI 读到的原话里能自动勾上几项 —— 一键采纳 */
  const aiSuggest = useMemo(
    () => (aiRawText ? matchCatalogItems(aiRawText) : { matched: [], unmatched: [] }),
    [aiRawText]
  );
  const notYetTaken = aiSuggest.matched.filter(m => !selectedNames.includes(m.name));

  return (
    <div ref={boxRef} className="relative">
      {/* 已选的摆在最上面 —— 人最想确认的是「我选了什么」 */}
      <div
        className="min-h-[42px] w-full cursor-text rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-500/20"
        onClick={() => setOpen(true)}
      >
        {selectedNames.length === 0 ? (
          <span className="px-1 text-sm text-gray-400">点这里从标准目录选，可多选</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedNames.map(n => {
              const known = catalogByName.has(n);
              return (
                <span
                  key={n}
                  className={`inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ${
                    known ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                  }`}
                  title={known ? '标准目录项' : '目录里没有这一项 —— 要么补进目录，要么换个标准写法'}
                >
                  <span className="truncate">{n}</span>
                  {!known && <span className="shrink-0 text-[10px]">· 非标准</span>}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggle(n); }}
                    className="shrink-0 rounded p-0.5 hover:bg-white/60"
                    aria-label={`移除 ${n}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* AI 勾的和人选的要对得上 —— 把原话摆出来，别让人猜 */}
      {aiRawText && (
        <div className="mt-1.5 rounded-lg bg-indigo-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-indigo-900">
          <Sparkles className="mr-1 inline h-3 w-3" />
          合同原文：{aiRawText}
          {notYetTaken.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(toServiceLine(
                [...selectedNames.map(n => ({ name: n })), ...notYetTaken]
              ))}
              className="ml-2 rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white hover:bg-indigo-700"
            >
              按原文补上 {notYetTaken.length} 项
            </button>
          )}
          {aiSuggest.unmatched.length > 0 && (
            <span className="ml-1 text-amber-700">
              · 这几段目录里没有：{aiSuggest.unmatched.join('、')}
            </span>
          )}
        </div>
      )}

      {open && (
        <>
          {/* 点空白处收起。data-dismiss-layer 的原因见 HelpHub 的 visibleModals() */}
          <div data-dismiss-layer="1" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                autoFocus
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="打 iso9001 / 体系 / 食品 / SC 都能找到"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>

            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <p className="sticky top-[41px] bg-gray-50 px-3 py-1 text-[10px] font-black tracking-widest text-gray-400">{cat}</p>
                {items.map(item => {
                  const on = selectedNames.includes(item.name);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item.name)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 ${on ? 'bg-blue-50/60' : ''}`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'}`}>
                        {on && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {item.code && <span className="shrink-0 font-mono text-[10px] text-gray-400">{item.code}</span>}
                    </button>
                  );
                })}
              </div>
            ))}

            {results.length === 0 && (
              <p className="px-3 py-3 text-xs font-bold text-gray-400">目录里没有「{keyword}」</p>
            )}

            {/* 口子：目录覆盖不到的，允许自己写，但会标成「非标准」 */}
            <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-100 bg-white px-3 py-2">
              <input
                value={customDraft}
                onChange={e => setCustomDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                placeholder="目录里没有？照合同原话写一条"
                className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400"
              />
              <button
                type="button"
                onClick={addCustom}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gray-900 px-2 py-1 text-xs font-black text-white hover:bg-gray-700"
              >
                <Plus className="h-3 w-3" /> 加上
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ServicePicker;
