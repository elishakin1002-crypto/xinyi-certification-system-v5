import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Compass, FileText, MousePointerClick, X, ArrowLeft, HelpCircle, AlertTriangle, Lightbulb } from 'lucide-react';
import { findPageGuide, findModalGuide, GuideEntry } from '../src/modules/help/pageGuide';
import { explainControl, ControlKind, ControlHelp } from '../src/modules/help/controlGuide';

/**
 * 帮助中心：一个「?」，三层帮助。
 *
 * ── 为什么是一个入口，不是三个 ────────────────────────────────
 *
 * 三层帮助如果摆成三个按钮，人就得先学会「我这个问题属于第几层」——
 * 那是把设计者的分类法当成使用者的常识。真实情况是他只有一个念头：
 * **「这什么意思？」**
 *
 * 所以入口只有一个问号，点开之后用他自己的话来分：
 *   「我是新来的，先带我走一遍」        → ① 岗位上手（原来的新手引导）
 *   「这一页是干什么的」                → ② 本页详解
 *   「这个按钮是什么意思」              → ③ 单项解释
 *
 * ── 为什么②要动态看当前在哪 ───────────────────────────────────
 *
 * 人最需要解释的时刻，是弹窗开着、面前一堆必填项的时候。
 * 那一刻讲「项目管理页分三块」毫无用处。所以打开帮助时先看有没有弹窗：
 * 有就讲弹窗，没有才讲整页。
 *
 * ── 为什么③做成「点哪讲哪」而不是问号图标 ────────────────────
 *
 * 给每个控件配一个小问号，界面上会多出几百个灰点，
 * 而它们平时全是噪音 —— 何况真正难懂的那几个多半正好没配上。
 *
 * 改成一个模式：进去之后**点屏幕上任何东西都会解释它**，
 * 解释完还在这个模式里，可以接着点下一个。平时界面干干净净。
 */

type Mode = 'menu' | 'page' | 'inspect';
type Rect = { top: number; left: number; width: number; height: number };

const NARROW = 768;
const PAD = 6;

/** 从一个 DOM 元素上取「界面上显示的名字」 */
const nameOf = (el: HTMLElement): string => {
  const explicit = el.getAttribute('data-help');
  if (explicit) return explicit;
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const title = el.getAttribute('title');
  if (title) return title;
  const ph = el.getAttribute('placeholder');
  /*
    只取**第一行**。

    很多按钮是两三行的（比如项目类别那三个：名字 + 什么时候建 + 钱怎么算），
    整段拿来当标题，卡片顶上就是一坨字，反而看不出在讲哪个。
    第一行就是它的名字，也正是规则表要匹配的东西。
  */
  const raw = (el.innerText || el.textContent || '').trim();
  const first = raw.split('\n').map(x => x.trim()).find(Boolean) || '';
  if (first) return first.slice(0, 60);
  if (ph) return ph;
  return el.getAttribute('name') || '';
};

/**
 * 把说明里的 `**着重**` 渲染成粗体。
 *
 * 说明是我用 markdown 的习惯写的，直接扔进 React 会原样显示两个星号 ——
 * 人看到的是「**必须选归属客户** —— …」，像没写完的代码。
 * 引入一个 markdown 库只为了粗体不值当，这里三行就够。
 */
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/\*\*/).map((part, idx) => (
      idx % 2 === 1 ? <strong key={idx} className="font-black">{part}</strong> : <span key={idx}>{part}</span>
    ))}
  </>
);

/** 判断这是个什么控件，用来在名字含糊时选对措辞 */
const kindOf = (el: HTMLElement): ControlKind => {
  const tag = el.tagName.toLowerCase();
  /*
    筛选下拉是「label 包着一个透明的 select」：点上去命中的是 label，
    而 label 本身既不是下拉也不是按钮。按 label 判种类会说成「一段说明文字」——
    人点的明明是个下拉。所以 label 里裹着控件时，按里面那个算。
  */
  if (tag === 'label') {
    const inner = el.querySelector('select, input, textarea') as HTMLElement | null;
    if (inner) return kindOf(inner);
  }
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return 'checkbox';
  if (tag === 'input' || tag === 'textarea') return 'input';
  if (tag === 'a') return 'link';
  if (el.getAttribute('role') === 'tab') return 'tab';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
  if (tag === 'span' || tag === 'td' || tag === 'th' || tag === 'div') return 'badge';
  return 'text';
};

/**
 * 找出「现在真的盖在屏幕上的弹窗」，最上面的排最后。
 *
 * ── 两个坑，都踩过 ────────────────────────────────────────────
 *
 * 1）**不能用 `offsetParent !== null` 判断可见。**
 *    规范里 position:fixed 的元素 offsetParent 就是 null ——
 *    而弹窗全都是 fixed，于是这个判断把**每一个弹窗都当成不可见**，
 *    「打开帮助时先讲当前弹窗」整套逻辑一次都没生效过。
 *    更糟的是它没报错：帮助照样弹出来，只是讲的是整页，
 *    看上去像「这功能就这样」。
 *
 *    反过来，手机版侧边栏因为祖先有 transform，fixed 退化成 absolute，
 *    offsetParent 反而不是 null —— 它是唯一被判成「可见」的，
 *    而它恰恰在屏幕外。判断结果正好全反了。
 *
 * 2）帮助自己的遮罩也是 `.fixed.inset-0`。
 *    `data-help-ui` 挂在外层容器上，所以要用 closest 往上找，
 *    不能只看元素自己有没有这个属性。
 *
 * 3）**「文档里最后一个」不等于「盖在最上面那个」。**
 *    AI 助手面板的类名里也有 `fixed inset-0`（手机上它确实铺满，
 *    电脑上被 `md:inset-auto` 收成右下角一块），而它排在弹窗后面，
 *    于是「取最后一个」永远取到它 —— 帮助又退回讲整页。
 *
 *    真正的弹窗有一个共同特征：**它铺满视口**（那层半透明遮罩）。
 *    所以按「几乎盖住整屏」来认，再按 z-index 取最上面那个。
 *    侧边栏 256 宽、AI 面板 432 宽，都自然被排除。
 */
const visibleModals = (): HTMLElement[] => {
  if (typeof document === 'undefined') return [];
  const vwNow = window.innerWidth;
  const vhNow = window.innerHeight;
  const zOf = (el: HTMLElement) => {
    const z = Number(window.getComputedStyle(el).zIndex);
    return Number.isFinite(z) ? z : 0;
  };
  return Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0'))
    .filter(el => {
      if (el.closest('[data-help-ui]')) return false;
      const r = el.getBoundingClientRect();
      // 铺满视口才算弹窗遮罩：宽高都得接近整屏，且确实压在屏幕上
      if (r.width < vwNow * 0.9 || r.height < vhNow * 0.9) return false;
      return r.right > 0 && r.bottom > 0 && r.left < vwNow && r.top < vhNow;
    })
    .sort((a, b) => zOf(a) - zOf(b));
};

/*
  能被讲解的东西。

  **刻意不含 `[data-guide-id]` 这类区块标记**：它套在一大片区域外面，
  点空白处会命中它，然后拿整块的第一行当名字 ——
  实测点了筛选条的空隙，得到的是「状态：一个状态标记，只是显示，点不动」，
  既不对又让人以为帮助在乱讲。宁可点空处什么都不弹。
*/
const SELECTABLE = [
  '[data-help]', 'button', 'a[href]', 'select', 'input', 'textarea', 'label',
  '[role="button"]', '[role="tab"]', 'th', '[data-onboard]'
].join(',');

export const HelpHub: React.FC<{
  open: boolean;
  onClose: () => void;
  /** 点「岗位上手」时调用 —— 引导组件由 Layout 持有 */
  onReplayTour: () => void;
  /** 弹窗遮住头部时，用这个从右下角把帮助叫出来 */
  onOpen: () => void;
}> = ({ open, onClose, onOpen, onReplayTour }) => {
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('menu');
  const [guide, setGuide] = useState<GuideEntry | null>(null);
  /** 讲的是弹窗还是整页 —— 标题上要说清楚，否则人以为帮助讲错了地方 */
  const [scope, setScope] = useState<'page' | 'modal'>('page');
  const [pick, setPick] = useState<{ rect: Rect; name: string; help: ControlHelp & { matched: boolean } } | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const isMobile = vw < NARROW;

  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
    ── 弹窗开着的时候，头部的「?」是够不着的 ────────────────────

    弹窗有半透明遮罩，盖住整个头部 —— 而**最需要解释的恰恰是这个时刻**：
    面前一堆必填项，不知道「项目类别」选哪个。
    做了一套「打开帮助时先讲当前弹窗」的逻辑，结果那个入口点不到，
    等于白做。

    所以弹窗开着时，在右下角浮出一个问号（AI 助手上面一点）。
    平时不显示 —— 头部那个已经够了，常驻两个入口才是画蛇添足。
  */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const check = () => setModalOpen(visibleModals().length > 0);
    check();
    const ob = new MutationObserver(check);
    ob.observe(document.body, { childList: true, subtree: true });
    return () => ob.disconnect();
  }, []);

  // 每次打开都从菜单开始：上次停在哪一层是我的实现细节，不该由使用者承担
  useEffect(() => { if (open) { setMode('menu'); setPick(null); } }, [open]);

  /**
   * 找出「现在该讲什么」。
   *
   * 先看有没有开着的弹窗：人最需要解释的时刻就是弹窗开着的时候。
   * 弹窗按标题认（见 pageGuide 的 MODAL_GUIDES），
   * 所以各页面不用为了帮助去改结构。
   */
  const resolveGuide = useCallback(() => {
    if (typeof document !== 'undefined') {
      const modals = visibleModals();
      const top = modals[modals.length - 1];
      if (top) {
        const heading = top.querySelector('h1, h2, h3')?.textContent || '';
        const found = findModalGuide(heading);
        if (found) { setScope('modal'); setGuide(found); return; }
        // 认不出这个弹窗时退回讲整页，而不是给一句「暂无说明」
      }
    }
    setScope('page');
    setGuide(findPageGuide(location.pathname));
  }, [location.pathname]);

  const enterPage = () => { resolveGuide(); setMode('page'); };

  /* ── ③ 单项解释：点哪讲哪 ─────────────────────────────── */

  useEffect(() => {
    if (!open || mode !== 'inspect' || typeof document === 'undefined') return;

    const inHelpUI = (el: Element | null) => Boolean(el && (el as HTMLElement).closest('[data-help-ui]'));

    const onClick = (e: MouseEvent) => {
      const raw = e.target as HTMLElement | null;
      if (!raw || inHelpUI(raw)) return;
      // 讲解模式下不让原来的按钮真的被按下去
      e.preventDefault();
      e.stopPropagation();
      // 点在空白处：不弹卡片，也不清掉已经打开的那张
      const el = raw.closest(SELECTABLE) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const name = nameOf(el);
      setPick({
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        name,
        help: explainControl(name, kindOf(el)),
      });
    };

    const onOver = (e: MouseEvent) => {
      const raw = e.target as HTMLElement | null;
      if (!raw || inHelpUI(raw)) { setHover(null); return; }
      const el = (raw.closest(SELECTABLE) as HTMLElement) || null;
      if (!el) { setHover(null); return; }
      const r = el.getBoundingClientRect();
      setHover({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMode('menu'); setPick(null); } };

    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'help';
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
    };
  }, [open, mode]);

  useLayoutEffect(() => {
    if (cardRef.current) {
      const h = cardRef.current.offsetHeight;
      if (Math.abs(h - cardH) > 4) setCardH(h);
    }
  });

  if (!open) {
    // 弹窗开着但帮助没开：只留右下角那个问号
    if (!modalOpen) return null;
    return (
      <button
        data-help-ui="1"
        type="button"
        onClick={onOpen}
        title="这个弹窗要我填什么？"
        className="fixed bottom-24 right-6 z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-indigo-600 shadow-lg transition-transform hover:scale-105"
      >
        <HelpCircle className="h-5 w-5" />
      </button>
    );
  }

  /* ── 布局：说明卡片必须整个露在屏幕里 ───────────────────────
     这一条是新手引导那边用血换来的：估高度摆气泡，结果「下一步」
     被挤出屏幕，引导直接走不下去。这里同样量真实高度再夹进视口。 */
  const cardStyle = (): React.CSSProperties => {
    if (!pick || isMobile) return {};
    const { rect } = pick;
    const W = 340;
    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.max(12, Math.min(left, vw - W - 12));
    const below = rect.top + rect.height + 10;
    const vh = window.innerHeight;
    const top = below + cardH + 12 < vh ? below : Math.max(12, rect.top - cardH - 10);
    return { position: 'fixed', top, left, width: W, zIndex: 95 };
  };

  return (
    <div data-help-ui="1">
      {/* ── ③ 讲解模式：高亮 + 顶部提示条 ── */}
      {mode === 'inspect' && (
        <>
          <div className="fixed inset-0 z-[88] pointer-events-none">
            {hover && (
              <div
                className="absolute rounded-lg ring-2 ring-indigo-400 bg-indigo-400/10 transition-all duration-75"
                style={{ top: hover.top - PAD, left: hover.left - PAD, width: hover.width + PAD * 2, height: hover.height + PAD * 2 }}
              />
            )}
            {pick && (
              <div
                className="absolute rounded-lg ring-2 ring-indigo-600"
                style={{ top: pick.rect.top - PAD, left: pick.rect.left - PAD, width: pick.rect.width + PAD * 2, height: pick.rect.height + PAD * 2 }}
              />
            )}
          </div>

          <div className="fixed inset-x-0 top-3 z-[96] flex justify-center px-4">
            <div className="flex items-center gap-3 rounded-full bg-indigo-600 px-4 py-2 text-white shadow-lg">
              <MousePointerClick className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold">点屏幕上任何东西，看它是什么意思</span>
              <button
                type="button"
                onClick={() => { setMode('menu'); setPick(null); }}
                className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-black hover:bg-white/30"
              >
                退出讲解
              </button>
            </div>
          </div>

          {pick && (
            <div
              ref={cardRef}
              style={cardStyle()}
              className={isMobile
                ? 'fixed inset-x-0 bottom-0 z-[95] rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl'
                : 'rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl'}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-black text-gray-900">{pick.name || '这个元素'}</p>
                <button onClick={() => setPick(null)} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[13px] font-bold leading-relaxed text-gray-700"><Rich text={pick.help.what} /></p>
              {pick.help.why && (
                <p className="mt-2 flex gap-1.5 text-[12px] font-bold leading-relaxed text-gray-500">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span><Rich text={pick.help.why} /></span>
                </p>
              )}
              {pick.help.warn && (
                <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] font-bold leading-relaxed text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><Rich text={pick.help.warn} /></span>
                </p>
              )}
              {!pick.help.matched && (
                <p className="mt-2 text-[11px] font-bold text-gray-400">
                  这一项还没写专门的说明。觉得该有，点顶部的反馈图标说一声。
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── ①②的面板 ── */}
      {mode !== 'inspect' && (
        <>
          <div className="fixed inset-0 z-[90] bg-black/30" onClick={onClose} />
          <div className={`fixed z-[91] bg-white shadow-2xl ${isMobile
            ? 'inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl'
            : 'right-6 top-20 w-[380px] max-h-[76vh] overflow-y-auto rounded-2xl border border-gray-200'}`}
          >
            <div className="sticky top-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4">
              {mode === 'page' && (
                <button onClick={() => setMode('menu')} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <HelpCircle className="h-5 w-5 text-indigo-600" />
              <h3 className="flex-1 text-sm font-black text-gray-900">
                {mode === 'menu' ? '需要哪种帮助？' : `${guide?.title || '这一页'}${scope === 'modal' ? '（当前弹窗）' : ''}`}
              </h3>
              <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {mode === 'menu' && (
              <div className="space-y-2 p-4">
                {/*
                  三个选项用**使用者的话**来分，不是「第一层第二层第三层」。
                  他脑子里的问题只有一个「这什么意思」，
                  分类是我的事，不该让他先学一遍。
                */}
                <button
                  type="button"
                  onClick={() => { onClose(); onReplayTour(); }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <Compass className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                  <span>
                    <span className="block text-sm font-black text-gray-900">我是新来的，带我走一遍</span>
                    <span className="mt-0.5 block text-xs font-bold leading-relaxed text-gray-500">
                      按你的岗位，从「进来第一件事做什么」开始，四到六步。看过一次以后不会再自动弹。
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={enterPage}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block text-sm font-black text-gray-900">这一页是干什么的</span>
                    <span className="mt-0.5 block text-xs font-bold leading-relaxed text-gray-500">
                      每个按钮都认识，但不知道整体该按什么顺序用 —— 看这个。弹窗开着时讲的是弹窗。
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMode('inspect'); setPick(null); }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <span>
                    <span className="block text-sm font-black text-gray-900">这个按钮是什么意思</span>
                    <span className="mt-0.5 block text-xs font-bold leading-relaxed text-gray-500">
                      进入讲解模式，点屏幕上任何东西都会告诉你它是什么、点了会怎样。这期间点什么都不会真的执行。
                    </span>
                  </span>
                </button>
              </div>
            )}

            {mode === 'page' && (
              <div className="space-y-5 p-5">
                {!guide && (
                  <p className="text-sm font-bold leading-relaxed text-gray-500">
                    这一页还没写详解。你可以先用「这个按钮是什么意思」逐个看，
                    或者点顶部的反馈图标告诉我们哪一页最需要说明。
                  </p>
                )}
                {guide && (
                  <>
                    <section>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-400">这一块负责什么</h4>
                      <p className="mt-1.5 text-[13px] font-bold leading-relaxed text-gray-700"><Rich text={guide.what} /></p>
                    </section>

                    <section>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-400">通常按这个顺序用</h4>
                      <ol className="mt-2 space-y-1.5">
                        {guide.order.map((s, idx) => (
                          <li key={idx} className="flex gap-2 text-[13px] font-bold leading-relaxed text-gray-700">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-black text-indigo-700">
                              {idx + 1}
                            </span>
                            <span><Rich text={s} /></span>
                          </li>
                        ))}
                      </ol>
                    </section>

                    <section>
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-400">各块各管什么</h4>
                      <dl className="mt-2 space-y-2">
                        {guide.areas.map(a => (
                          <div key={a.name} className="rounded-xl bg-gray-50 px-3 py-2">
                            <dt className="text-xs font-black text-gray-900">{a.name}</dt>
                            <dd className="mt-0.5 text-[12px] font-bold leading-relaxed text-gray-600"><Rich text={a.role} /></dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    {guide.misread && (
                      <section className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <h4 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          最容易误会的一点
                        </h4>
                        <p className="mt-1 text-[12px] font-bold leading-relaxed text-amber-900"><Rich text={guide.misread} /></p>
                      </section>
                    )}
                  </>
                )}

                {/* 看完介绍，下一步该是动手 —— 别让人读完了还得自己想「那我现在点哪」 */}
                <button
                  type="button"
                  onClick={() => { setMode('inspect'); setPick(null); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-700"
                >
                  <MousePointerClick className="h-4 w-4" />
                  接着看具体某一项是什么意思
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HelpHub;
