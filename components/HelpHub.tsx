import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PERSONA_TO_ROLE } from '../constants';
import { adaptPageGuide, RolePageGuide } from '../src/modules/help/rolePageGuide';
import { Compass, FileText, MousePointerClick, X, ArrowLeft, HelpCircle, AlertTriangle, Lightbulb, ArrowRight, BookOpen } from 'lucide-react';
import { findPageGuide, findModalGuide } from '../src/modules/help/pageGuide';
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
 *   「解释这一项」              → ③ 单项解释
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
      idx % 2 === 1 ? <strong key={idx} className="font-semibold">{part}</strong> : <span key={idx}>{part}</span>
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
 *
 * 4）**下拉菜单的「点空白处关闭」层，长得和弹窗遮罩一模一样。**
 *    2026-09-11 金恩来：「点击头像时，右下角的问号怎么还在那里？」
 *
 *    头像菜单、铃铛面板、手机侧边栏都各铺一层 `fixed inset-0` 来接
 *    「点外面关掉我」这个手势 —— 铺满整屏、fixed、可见，
 *    上面三条规则一条都筛不掉它。于是点一下头像，
 *    右下角就冒出「这个弹窗要我填什么？」，而根本没有东西要填。
 *
 *    **靠长相区分已经到头了**：这一层和弹窗遮罩在 DOM 上没有任何
 *    可靠差别。所以改成让它自己声明身份 —— `data-dismiss-layer`。
 *    以后再加下拉菜单，照着标一下即可；漏标会被
 *    tests/help-modal-detection.test.js 挡住。
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
      // 下拉菜单的「点空白处关闭」层：长得像遮罩，但没有任何东西要填
      if (el.closest('[data-dismiss-layer]')) return false;
      // 手机 AI 面板隐藏时仍占满屏幕；尺寸存在不代表用户看得见。
      // 连同祖先一起检查，避免把 opacity:0 的抽屉当成当前业务弹窗。
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
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
  initialMode?: 'menu' | 'page';
  onClose: () => void;
  /** 点「岗位上手」时调用 —— 引导组件由 Layout 持有 */
  onReplayTour: () => void;
  /** 弹窗遮住头部时，用这个从右下角把帮助叫出来 */
  onOpen: () => void;
}> = ({ open, initialMode = 'menu', onClose, onOpen, onReplayTour }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeRole, previewPersona, setIsModuleGuideActive } = useApp();
  const [hasSample, setHasSample] = useState(false);
  const guideRole = previewPersona ? PERSONA_TO_ROLE[previewPersona] : activeRole;
  const [mode, setMode] = useState<Mode>('menu');
  const [guide, setGuide] = useState<RolePageGuide | null>(null);
  /** 讲的是弹窗还是整页 —— 标题上要说清楚，否则人以为帮助讲错了地方 */
  const [scope, setScope] = useState<'page' | 'modal'>('page');
  const [pick, setPick] = useState<{ rect: Rect; name: string; help: ControlHelp & { matched: boolean } } | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const isMobile = vw < NARROW;

  const [pageIndex, setPageIndex] = useState(0);
  const pageRoot = useRef<HTMLElement | null>(null);
  const [pageRect, setPageRect] = useState<Rect | null>(null);
  const pageCard = useRef<HTMLDivElement>(null);
  const [pageCardH, setPageCardH] = useState(420);
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
  useEffect(() => { if (open) { setPick(null); if (initialMode === 'page') enterPage(); else setMode('menu'); } }, [open, initialMode]);

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
        if (found) { pageRoot.current = top; setScope('modal'); setGuide(found); return; }
        pageRoot.current = top;
        setScope('modal');
        setGuide({ title: heading || '当前窗口', what: '这里处理当前选中的业务。先确认对象，再填写和核对资料。', order: ['核对当前处理对象和必填信息', '填写后检查内容，再决定保存或取消'], areas: [{name: '填写区域', role: '具体字段的含义可以用「解释这一项」点选查看。'}] });
        return;
      }
    }
    pageRoot.current = document.querySelector('main');
    setScope('page');
    setGuide(adaptPageGuide(location.pathname, findPageGuide(location.pathname), guideRole));
  }, [location.pathname, guideRole]);

  const enterPage = () => { resolveGuide(); setPageIndex(0); setMode('page'); };

  useEffect(() => {
    setIsModuleGuideActive(open && mode === 'page');
    if (!open || mode !== 'page') { setHasSample(false); return; }
    const timer = window.setTimeout(() => setHasSample(Boolean(pageRoot.current?.querySelector('[data-sample="1"]'))), 120);
    return () => { window.clearTimeout(timer); setIsModuleGuideActive(false); };
  }, [open, mode, location.pathname, setIsModuleGuideActive]);

  const pageSteps = guide ? [
    { title: '这个模块负责什么', text: guide.what },
    { title: '通常按什么顺序使用', text: guide.order.map((line, index) => `${index + 1}. ${line}`).join('\n\n') },
    ...guide.areas.map(area => ({ title: area.name, text: area.role })),
    ...(hasSample ? [{title: '对照样例认识一条记录', text: '标着「样例」的记录使用本页的字段与布局。按表头或卡片标签查看名称、状态和负责人。样例只供观察，不会保存、提交或计入统计；实际操作请退出帮助后使用真实记录。', sample: true}] : []),
    ...(guide.result ? [{title: '做完后去哪里看结果', text: guide.result + (guide.empty ? '\n\n没有记录时：' + guide.empty : '')}] : []),
    ...(guide.misread ? [{ title: '使用时留意这一点', text: guide.misread }] : []),
  ] : [];

  // 只定位已有区域，不模拟业务点击。找不到精确位置时保持普通说明卡。
  useLayoutEffect(() => {
    if (!open || mode !== 'page') { setPageRect(null); return; }
    const update = () => {
      const root = pageRoot.current;
      let target: HTMLElement | null = null;
      const visible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
      };
      if (root) {
        if ('sample' in (pageSteps[pageIndex] || {})) target = Array.from(root.querySelectorAll<HTMLElement>('[data-sample="1"]')).find(el => el.getBoundingClientRect().width > 0) || null;
        else if (pageIndex === 0) target = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3')).find(visible) || null;
        else if (pageIndex === 1) target = Array.from(root.querySelectorAll<HTMLElement>('form,table,[role="tablist"]')).find(visible) || null;
        else {
          const name = guide?.areas[pageIndex - 2]?.name;
          if (name) target = Array.from(root.querySelectorAll<HTMLElement>('h2,h3,h4,[data-help],[aria-label]')).find(el => visible(el) && (el.textContent?.trim() === name || el.getAttribute('aria-label') === name || el.dataset.help === name)) || null;
        }
      }
      if (target) {
        const r = target.getBoundingClientRect();
        setPageRect({ top: Math.max(8, r.top), left: Math.max(8, r.left), width: Math.min(r.right, window.innerWidth - 8) - Math.max(8, r.left), height: Math.min(r.bottom, window.innerHeight - 8) - Math.max(8, r.top) });
      } else setPageRect(null);
      if (pageCard.current) setPageCardH(pageCard.current.getBoundingClientRect().height);
    };
    if ('sample' in (pageSteps[pageIndex] || {})) {
      const sample = Array.from(pageRoot.current?.querySelectorAll<HTMLElement>('[data-sample="1"]') || []).find(el => el.getBoundingClientRect().width > 0);
      if (sample) { sample.style.scrollMarginTop = '96px'; sample.scrollIntoView({block: 'start'}); }
    }
    update();
    const observer = new ResizeObserver(update);
    if (pageCard.current) observer.observe(pageCard.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open, mode, pageIndex, guide, hasSample]);

  useEffect(() => { if (open && mode === 'page') { resolveGuide(); setPageIndex(0); } }, [location.pathname, guideRole]);

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

    const onPointerDown = (e: PointerEvent) => {
      if (!inHelpUI(e.target as Element)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMode('menu'); setPick(null); }
      if (!inHelpUI(e.target as Element)) { e.preventDefault(); e.stopPropagation(); }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'help';
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
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
        className="fixed bottom-24 right-6 z-[60] flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-blue-600 shadow-lg transition-transform hover:scale-105"
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
                className="absolute rounded-lg ring-2 ring-blue-400 bg-blue-400/10 transition-all duration-75"
                style={{ top: hover.top - PAD, left: hover.left - PAD, width: hover.width + PAD * 2, height: hover.height + PAD * 2 }}
              />
            )}
            {pick && (
              <div
                className="absolute rounded-lg ring-2 ring-blue-600"
                style={{ top: pick.rect.top - PAD, left: pick.rect.left - PAD, width: pick.rect.width + PAD * 2, height: pick.rect.height + PAD * 2 }}
              />
            )}
          </div>

          <div className="fixed inset-x-0 top-3 z-[96] flex justify-center px-4">
            <div className="flex items-center gap-3 rounded-full bg-blue-600 px-4 py-2 text-white shadow-lg">
              <MousePointerClick className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium">点选不懂的内容 · 只解释，不执行操作</span>
              <button
                type="button"
                onClick={() => { setMode('menu'); setPick(null); }}
                className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/30"
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
                ? 'fixed inset-x-0 bottom-0 z-[95] max-h-[65dvh] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl'
                : 'max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-xl'}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{pick.name || '这个元素'}</p>
                <button onClick={() => setPick(null)} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-gray-700"><Rich text={pick.help.what} /></p>
              {pick.help.why && (
                <p className="mt-2 flex gap-1.5 text-[12px] font-medium leading-relaxed text-gray-500">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span><Rich text={pick.help.why} /></span>
                </p>
              )}
              {pick.help.warn && (
                <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] font-medium leading-relaxed text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><Rich text={pick.help.warn} /></span>
                </p>
              )}
              {!pick.help.matched && (
                <p className="mt-2 text-[11px] font-medium text-gray-400">
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
          <div className={`fixed inset-0 z-[90] ${mode === 'page' && pageRect ? '' : 'bg-black/30'}`} onClick={onClose} />
          {mode === 'page' && pageRect && <div className="fixed z-[90] pointer-events-none rounded-xl ring-2 ring-blue-500" style={{...pageRect, boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)'}} /> }
          <div ref={pageCard} role="dialog" aria-modal="true" aria-label={mode === 'menu' ? '新手引导' : '了解当前模块'} style={mode === 'page' && pageRect && !isMobile ? {
            left: Math.max(12, Math.min(pageRect.left + pageRect.width + 16 + 380 < vw ? pageRect.left + pageRect.width + 16 : pageRect.left - 396 > 12 ? pageRect.left - 396 : vw - 404, vw - 392)),
            top: Math.max(12, Math.min(pageRect.left + pageRect.width + 396 < vw || pageRect.left > 408 ? pageRect.top : pageRect.top + pageRect.height + 16 + pageCardH < window.innerHeight - 12 ? pageRect.top + pageRect.height + 16 : pageRect.top - pageCardH - 16 > 12 ? pageRect.top - pageCardH - 16 : window.innerHeight - pageCardH - 12, window.innerHeight - pageCardH - 12)), right: 'auto',
          } : undefined} className={`fixed z-[91] flex flex-col bg-white shadow-xl ${isMobile
            ? 'inset-x-0 bottom-0 max-h-[75dvh] overflow-hidden rounded-t-3xl'
            : 'right-6 top-20 w-[380px] max-h-[calc(100dvh-40px)] overflow-hidden rounded-2xl border border-gray-200'}`}
          >
            <div className="shrink-0 flex items-center gap-2 border-b border-gray-100 bg-white px-5 py-4">
              {mode === 'page' && (
                <button onClick={() => setMode('menu')} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <HelpCircle className="h-5 w-5 text-blue-600" />
              <h3 className="flex-1 text-sm font-semibold text-gray-900">
                {mode === 'menu' ? '你想了解什么？' : `${guide?.title || '这一页'}${scope === 'modal' ? '（当前弹窗）' : ''}`}
              </h3>
              <button aria-label="关闭帮助" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {mode === 'menu' && (
              <div className="space-y-3 p-5 overflow-y-auto"><p className="mb-4 text-sm leading-relaxed text-gray-500">第一次用，先认识工作台；工作中有疑问，随时回来查。</p>
                {/*
                  三个选项用**使用者的话**来分，不是「第一层第二层第三层」。
                  他脑子里的问题只有一个「这什么意思」，
                  分类是我的事，不该让他先学一遍。
                */}
                <button
                  type="button"
                  onClick={() => { onClose(); onReplayTour(); }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <Compass className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">认识我的工作台</span>
                    <span className="mt-0.5 block text-xs font-medium leading-relaxed text-gray-500">
                      认识你的岗位、系统导航与各模块之间的关系。
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={enterPage}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">了解当前模块</span>
                    <span className="mt-0.5 block text-xs font-medium leading-relaxed text-gray-500">
                      了解当前模块的用途、使用顺序和区域分工。打开窗口时，优先介绍当前窗口。
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMode('inspect'); setPick(null); }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">解释这一项</span>
                    <span className="mt-0.5 block text-xs font-medium leading-relaxed text-gray-500">
                      点选不懂的按钮、字段或数据，了解含义和操作结果。讲解期间不会执行操作。
                    </span>
                  </span>
                </button>

                {/*
                  第四层：字段档案（2026-09-18 加）。

                  前三层回答的是「这一页/这个按钮是干什么的」，
                  但同事最常卡住的其实是**两个数字对不上**：
                  工作台写「逾期任务 5」，项目管理写「0」——
                  他第一反应是系统坏了，而真相是两张卡的口径不同。
                  「解释这一项」只能解释他点得到的那一个，
                  这一层是把全部口径摊开让他自己比。
                */}
                <button
                  type="button"
                  onClick={() => { onClose(); navigate('/glossary'); }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">字段档案</span>
                    <span className="mt-0.5 block text-xs font-medium leading-relaxed text-gray-500">
                      每个数字数的是什么、不包括什么。<b>两个数字对不上时先查这里</b> —— 多半是两张卡的口径不同，不是系统算错了。
                    </span>
                  </span>
                </button>
              </div>
            )}

            {mode === 'page' && (
              <>
                <div className="px-5 pt-4 shrink-0">
                  <div className="h-1 rounded-full bg-gray-100"><div className="h-1 rounded-full bg-blue-600 transition-all" style={{width: `${(pageIndex + 1) / Math.max(1, pageSteps.length) * 100}%`}} /></div>
                  <label className="mt-4 block text-xs text-gray-500">想了解哪一项？
                    <select aria-label="选择模块讲解内容" value={pageIndex} onChange={e => setPageIndex(Number(e.target.value))} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                      {pageSteps.map((item, index) => <option key={index} value={index}>{index + 1}. {item.title}</option>)}
                    </select>
                  </label>
                </div>
                <div className="overflow-y-auto min-h-0 px-5 py-5">
                  <p className="mb-2 text-xs text-gray-400">第 {pageIndex + 1} 步 / 共 {pageSteps.length} 步 · {scope === 'modal' ? '当前窗口' : '当前模块'}</p>
                  <h4 className="mb-3 text-[17px] font-semibold text-gray-900">{pageSteps[pageIndex]?.title || '当前模块'}</h4>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700"><Rich text={pageSteps[pageIndex]?.text || '可使用「解释这一项」查看具体内容。'} /></p>
                </div>
                <div className="shrink-0 border-t border-gray-100 px-5 pt-3 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={onClose} className="py-2 text-xs text-gray-500">稍后再看</button>
                    <div className="flex gap-2">
                      {pageIndex > 0 && <button onClick={() => setPageIndex(pageIndex - 1)} className="rounded-xl px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100">上一步</button>}
                      <button onClick={() => pageIndex < pageSteps.length - 1 ? setPageIndex(pageIndex + 1) : onClose()} className="flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">{pageIndex < pageSteps.length - 1 ? '下一步' : '我知道了'}<ArrowRight className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-gray-500">
                    <button onClick={() => setMode('menu')} className="hover:text-blue-600">返回帮助选择</button>
                    <button onClick={() => { setMode('inspect'); setPick(null); }} className="hover:text-blue-600">解释这一项</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HelpHub;
