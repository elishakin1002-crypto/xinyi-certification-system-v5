import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, X, ArrowRight, ArrowLeft, CheckCircle2, CornerLeftUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../context/AppContext';
import { dataService } from '../services/dataService';
import { getTour } from '../src/modules/onboarding/steps';

/**
 * 新手引导。
 *
 * ── 五条设计原则 ──────────────────────────────────────────────
 *
 * 1）**说到哪，就指到哪。**
 *    2026-09-05 反馈：「只会在左侧导航栏里跳动，却没有解释到哪，就指向哪里」。
 *    查下来 steps.ts 里的 target 字段**从头到尾是死代码** ——
 *    组件只弹了个居中的框，从来没用过它。
 *
 *    人读引导时脑子里在问的是「它说的那个东西在屏幕哪儿」。
 *    这个问题不回答，讲得再有道理也落不了地。
 *
 * 2）**框子必须完整露在屏幕里。**
 *    第一版按元素位置摆气泡时，高度用的是拍脑袋的估计值 260px。
 *    实际卡片有三四百像素高，指到左下角「员工账号」时，
 *    **「下一步」按钮被挤出了屏幕底部** —— 引导直接卡死在第 3 步。
 *
 *    所以现在量真实高度，再夹进视口；真放不下就让正文自己滚动，
 *    **按钮那一条永远贴在卡片底部，不参与滚动**。
 *    一个走不下去的引导比没有引导更糟。
 *
 * 3）**手机上换一种形态，不是把电脑版缩小。**
 *    手机屏幕窄，气泡贴在元素旁边会把内容整个盖住；
 *    而且左侧导航在手机上是收起来的 —— 指「左侧导航第三项」毫无意义。
 *    所以手机上：说明做成**底部抽屉**，指向导航项时改为高亮左上角的 ☰
 *    并说明「在这个菜单里」。
 *
 * 4）**必须能跳过，而且跳过要显眼。**
 * 5）**必须能重看，看过就不再自动弹。**
 */

const seenKey = (userId: string) => `onboard_seen_${userId}`;

/** 高亮框四周留的空隙 */
const PAD = 8;
const CARD_W = 380;
/** 低于这个宽度按手机处理：导航收起、气泡改抽屉 */
const NARROW = 768;
/** 卡片四周至少留出的边距，保证按钮不贴边、不出屏 */
const EDGE = 12;

type Rect = { top: number; left: number; width: number; height: number };

export const OnboardingTour: React.FC<{
  /** 手动重看时传 true，绕过「看过就不弹」的判断 */
  forceOpen?: boolean;
  onClose?: () => void;
}> = ({ forceOpen = false, onClose }) => {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  /** 指的是不是「手机上收起来的菜单」而不是原本那一项 */
  const [viaMenu, setViaMenu] = useState(false);
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  /** 卡片实测高度。**不能用估计值**，见文件头第 2 条 */
  const [cardH, setCardH] = useState(300);
  const cardRef = useRef<HTMLDivElement>(null);

  const tour = getTour(currentUser?.roles as any);
  const isMobile = vw < NARROW;

  useEffect(() => {
    if (forceOpen) { setOpen(true); setI(0); return; }
    if (!tour || !currentUser?.id) return;
    try {
      const seen = Number(dataService.get(seenKey(currentUser.id), 0));
      // 版本比对而不是布尔值：内容有实质更新时 +1，看过旧版的人会再看一次
      if (seen < tour.version) setOpen(true);
    } catch { /* 读不到就不弹，不打扰 */ }
  }, [forceOpen, tour, currentUser?.id]);

  const step = open && tour && i > 0 ? tour.steps[i - 1] : null;
  const targetSel = step?.target;

  /*
    找到要指的那个元素，量出它的位置。

    手机上导航是收起来的，`nav-*` 这类目标根本不在页面上。
    这时候退而指左上角的 ☰ —— 那才是他真正要点的第一下。
    指不到又没有替代的，就退回不带高亮的说明，绝不报错也绝不空白。
  */
  const measure = useCallback(() => {
    if (!targetSel || typeof document === 'undefined') { setRect(null); setViaMenu(false); return; }
    const pick = (sel: string) => document.querySelector<HTMLElement>(`[data-onboard="${sel}"]`);
    let el = pick(targetSel);
    let byMenu = false;

    /*
      「在屏幕上」不等于「宽高不为 0」。

      手机上侧边栏是**整体平移到屏幕外**（transform: -translate-x-full），
      不是 display:none —— 宽高照旧，getBoundingClientRect 给出的是
      x = -351 这种负坐标。只判断宽高的话会认为它可见，
      于是高亮框画到了屏幕外面：人看到的是「整页变暗、什么都没框住」。

      所以还要判断它和视口有没有交集。
    */
    const visible = (n: HTMLElement | null) => {
      if (!n) return false;
      const r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return r.right > 0 && r.bottom > 0
        && r.left < window.innerWidth && r.top < window.innerHeight;
    };

    if (!visible(el) && targetSel.startsWith('nav-')) {
      el = pick('mobile-menu');
      byMenu = visible(el);
      if (!byMenu) el = null;
    }
    if (!visible(el)) { setRect(null); setViaMenu(false); return; }

    const r = el!.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    setViaMenu(byMenu);
  }, [targetSel]);

  useLayoutEffect(() => {
    if (!open) return;
    /*
      量两次：切页面之后 DOM 要一帧才渲染出来，立刻量会量到旧位置。
      第二次延后 260ms，覆盖页面切换 + 滚动动画。
    */
    measure();
    const t = window.setTimeout(() => {
      const el = targetSel && document.querySelector<HTMLElement>(`[data-onboard="${targetSel}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(measure, 260);
    }, 60);
    return () => window.clearTimeout(t);
  }, [open, i, targetSel, measure]);

  /*
    量卡片的真实高度。

    留 4px 死区：不加的话高度在两个相邻值之间来回跳，
    setState → 重排 → 又量到新值，无限循环。
  */
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const h = cardRef.current.getBoundingClientRect().height;
    if (h > 0 && Math.abs(h - cardH) > 4) setCardH(h);
  });

  useEffect(() => {
    if (!open) return;
    const onChange = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      measure();
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [open, measure]);

  if (!open || !tour) return null;

  const total = tour.steps.length;
  const isIntro = i === 0;
  /** 电脑上且指得到元素时，说明才贴着元素放 */
  const anchored = Boolean(rect) && !isMobile;

  const finish = () => {
    try {
      if (currentUser?.id) dataService.set(seenKey(currentUser.id), tour.version);
    } catch { /* 记不住就下次再弹一遍，无所谓 */ }
    setOpen(false);
    onClose?.();
  };

  const go = (next: number) => {
    const s = next === 0 ? null : tour.steps[next - 1];
    if (s?.route) navigate(s.route);
    setRect(null);          // 先清掉旧位置，避免气泡在旧坐标上闪一下
    setI(next);
  };

  /*
    气泡放哪：优先放元素右边（导航在左侧，最常见），
    右边放不下放左边，然后夹进视口。

    **纵向用实测高度夹**，这是「下一步被挤出屏幕」那个 bug 的修法。
  */
  const cardPos = (): React.CSSProperties => {
    if (!anchored || !rect) return {};
    const gap = 16;
    let left = rect.left + rect.width + gap;
    if (left + CARD_W > vw - EDGE) left = rect.left - CARD_W - gap;
    if (left < EDGE) left = Math.min(Math.max(EDGE, rect.left), vw - CARD_W - EDGE);

    const maxH = vh - EDGE * 2;
    const h = Math.min(cardH, maxH);
    let top = rect.top + rect.height / 2 - h / 2;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    return { position: 'fixed', top, left, width: CARD_W, maxHeight: maxH };
  };

  const maskColor = 'rgba(0,0,0,0.55)';
  const hole = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  /*
    正文可滚，页脚（上一步/下一步）不可滚。

    这样无论内容多长、屏幕多矮，**操作按钮永远在**。
    第一版正是因为整张卡片一起被推出屏幕，人卡在第 3 步走不动。
  */
  const card = (
    <div
      ref={cardRef}
      style={anchored ? cardPos() : undefined}
      className={[
        'bg-white border border-gray-200 shadow-xl overflow-hidden pointer-events-auto flex flex-col',
        anchored ? 'rounded-2xl z-[72]' : '',
        !anchored && isMobile ? 'rounded-t-2xl w-full max-h-[70vh]' : '',
        !anchored && !isMobile ? 'rounded-2xl w-full max-w-md max-h-[calc(100vh-24px)]' : '',
      ].join(' ')}
    >
      {/*
        ── 外观跟系统其他地方一致（2026-09-05 改）──────────────

        原来是一条实心蓝的标题栏。系统里所有卡片都是白底、细边、
        圆角、蓝色只用在强调上 —— 一整条蓝在这里显得像另一个软件贴上来的弹窗，
        而引导恰恰是新人对这套系统的第一印象。

        现在改成和别处一样：白底细边，「新手引导」缩成一个小标签。
      */}
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 shrink-0">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">
          <Compass className="w-3.5 h-3.5" />
          新手引导
        </span>
        {/* 跳过键放最显眼的右上角。藏跳过键换来的「完成率」是假的 */}
        <button
          onClick={finish}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          跳过 <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-5 pb-1 overflow-y-auto grow">
        {isIntro ? (
          <>
            <h3 className="text-[17px] font-black leading-snug text-gray-900 mb-2">{currentUser?.name}，欢迎</h3>
            <div className="text-sm text-gray-800 leading-relaxed prose-sm">
              <ReactMarkdown>{tour.intro}</ReactMarkdown>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] font-black text-gray-400 mb-1.5">
              第 {i} 步 / 共 {total} 步
              {/*
                指不到的时候明说，而不是假装指到了。
                措辞刻意含糊：可能是权限、可能要先选中一个项目、也可能列表还空着。
                **说不准就别说死** —— 写成「你没权限」而实际只是没数据，比不说更误导。
              */}
              {step?.target && !rect && (
                <span className="ml-2 font-bold text-gray-300">（这一块现在不在屏幕上）</span>
              )}
            </p>
            <h3 className="text-[17px] font-black leading-snug text-gray-900 mb-2">{step!.title}</h3>
            {/* 手机上导航是收起来的，先告诉他要点哪儿才能看到 */}
            {viaMenu && (
              <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                <CornerLeftUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                手机上这一项收在左上角这个菜单里，点开就能看到。
              </p>
            )}
            <div className="text-sm text-gray-700 leading-relaxed">
              <ReactMarkdown>{step!.body}</ReactMarkdown>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5 mt-2 border-t border-gray-100 shrink-0">
        <div className="flex gap-1">
          {Array.from({ length: total + 1 }).map((_, n) => (
            <span key={n} className={`h-1.5 rounded-full transition-all ${
              n === i ? 'w-5 bg-blue-600' : 'w-1.5 bg-gray-300'
            }`} />
          ))}
        </div>
        <div className="flex gap-2">
          {i > 0 && (
            <button onClick={() => go(i - 1)}
              className="px-3 h-9 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-200 flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> 上一步
            </button>
          )}
          {i < total ? (
            <button onClick={() => go(i + 1)}
              className="px-4 h-9 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 flex items-center gap-1">
              {isIntro ? '开始' : '下一步'} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={finish}
              className="px-4 h-9 rounded-xl bg-green-600 text-white text-xs font-black hover:bg-green-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> 开始使用
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/*
        遮罩用四块拼出来，中间留个洞。

        没用 SVG mask 或 box-shadow 撑出的洞：那两种写法在元素有圆角、
        或页面横向滚动时容易错半个像素，露出一条黑边，看着像渲染坏了。
        四块矩形笨，但在任何位置都不会错。
      */}
      {hole ? (
        <>
          <div className="fixed z-[70]" onClick={finish}
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top), background: maskColor }} />
          <div className="fixed z-[70]" onClick={finish}
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0, background: maskColor }} />
          <div className="fixed z-[70]" onClick={finish}
            style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height, background: maskColor }} />
          <div className="fixed z-[70]" onClick={finish}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height, background: maskColor }} />
          {/* 高亮描边。pointer-events-none：不挡住被指的那个按钮 */}
          <div className="fixed z-[71] rounded-xl pointer-events-none ring-4 ring-blue-500/70 animate-pulse"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/50 z-[70]" onClick={finish} />
      )}

      {anchored ? card : (
        <div className={`fixed inset-0 z-[71] flex pointer-events-none ${
          isMobile ? 'items-end justify-center' : 'items-center justify-center p-4'
        }`}>
          {card}
        </div>
      )}
    </>
  );
};

export default OnboardingTour;
