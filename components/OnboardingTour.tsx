import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, X, ArrowRight, ArrowLeft, CheckCircle2, CornerLeftUp, MousePointerClick } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../context/AppContext';
import { PERSONA_TO_ROLE } from '../constants';
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

/** 预览时标题上写谁的引导 */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: '总经理', SYS_ADMIN: '系统管理员', MANAGER: '总助',
  SALES: '销售', CONSULTANT: '咨询顾问', FINANCE: '财务',
};

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
  const { currentUser, previewPersona } = useApp();
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

  /*
    ── 引导跟着预览视角走（2026-09-07）──────────────────────────

    右上角切视角本来只换工作台和菜单，引导仍然是**自己那一份** ——
    于是「我想看看顾问的引导长什么样」这件事，只能去借顾问的账号登录，
    而借账号又要重置密码，重置完人家下次登录就被要求改密码。
    为了看一眼引导，惊动一个正在干活的同事，代价完全不成比例。

    巡检视角存在的意义就是「看看同事看到什么」，
    引导是同事看到的第一样东西，没有理由被排除在外。

    **预览时不写「看过」标记**：那是别人的引导，不该算进自己的进度，
    也不该让自己那份下次不弹了。
  */
  const previewRole = previewPersona ? PERSONA_TO_ROLE[previewPersona] : null;
  const isPreviewing = Boolean(previewRole) && !currentUser?.roles?.includes(previewRole!);
  const tour = getTour((isPreviewing ? [previewRole!] : currentUser?.roles) as any);
  const isMobile = vw < NARROW;

  useEffect(() => {
    if (forceOpen) { setOpen(true); setI(0); return; }
    // 预览别人的引导只在手动「重看」时出现，不主动弹
    if (isPreviewing) return;
    if (!tour || !currentUser?.id) return;
    try {
      const seen = Number(dataService.get(seenKey(currentUser.id), 0));
      // 版本比对而不是布尔值：内容有实质更新时 +1，看过旧版的人会再看一次
      if (seen < tour.version) setOpen(true);
    } catch { /* 读不到就不弹，不打扰 */ }
  }, [forceOpen, tour, currentUser?.id, isPreviewing]);

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
      /*
        手机上说明是**底部抽屉**，占掉屏幕下半部分。
        还按 center 滚的话，被指的那块正好落在抽屉底下 ——
        高亮框画出来了，可人看不见，等于没指。
        所以手机上滚到上半屏（start），电脑上仍然居中。
      */
      if (el) el.scrollIntoView({ block: window.innerWidth < NARROW ? 'start' : 'center', behavior: 'smooth' });
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
  /* 手机有单独写就用手机那份，没写就沿用电脑那份 */
  const howTo = (isMobile ? (step?.howToMobile || step?.howTo) : step?.howTo) || [];

  /*
    ── 抽屉要会躲（2026-09-06）────────────────────────────────

    手机上说明是底部抽屉。指「右下角的 AI 助手」时，
    抽屉正好把它盖住 —— 高亮框画出来了，人却看不见，等于没指。

    所以被指的东西落在屏幕下半部分时，抽屉改成从**顶部**下来。
    上半部分的目标（比如左上角的 ☰）仍然用底部抽屉。
  */
  const sheetAtTop = isMobile && Boolean(rect) && rect!.top > vh * 0.42;

  const finish = () => {
    try {
      // 预览别人的引导时不留痕：那不是自己的进度
      if (currentUser?.id && !isPreviewing) dataService.set(seenKey(currentUser.id), tour.version);
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
        !anchored && isMobile
          ? `w-full max-h-[62vh] shadow-2xl ${sheetAtTop ? 'rounded-b-2xl border-t-0' : 'rounded-t-2xl border-b-0'}`
          : '',
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
      {/* 手机上给个把手，一眼看出这是从底下拉上来的一层，不是盖住页面的弹窗 */}
      {!anchored && isMobile && !sheetAtTop && (
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="h-1 w-9 rounded-full bg-gray-300" />
        </div>
      )}

      <div className={`flex items-center justify-between gap-3 px-5 shrink-0 ${
        !anchored && isMobile ? 'pt-1.5 pb-2.5' : 'pt-4 pb-3'
      }`}>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${
          isPreviewing ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
        }`}>
          <Compass className="w-3.5 h-3.5" />
          {/* 预览时说清这是谁的引导，否则看到「录线索」会以为自己该去录 */}
          {isPreviewing ? `预览：${ROLE_LABEL[previewRole!] || previewRole}的引导` : '新手引导'}
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
            {/*
              预览别人的引导时不能写「你的名字，欢迎」——
              那句话是对本人说的，套在预览上会读成「我是总经理，
              而这套系统对我来说是……顾问的事」，前后打架。
            */}
            <h3 className="text-[17px] font-black leading-snug text-gray-900 mb-2">
              {isPreviewing
                ? `${ROLE_LABEL[previewRole!] || previewRole}第一次登录会看到`
                : `${currentUser?.name}，欢迎`}
            </h3>
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

            {/*
              ── 「怎么做」（2026-09-06 加）──────────────────────

              原来每一步只讲道理。道理确实比「点这里新建线索」好记，
              但**只有道理落不了地**：合上引导之后，人还是不知道第一下点哪儿。

              手机那份单独写：手机上左侧导航是收起来的，
              「左边点项目管理」这句话在手机上是错的。
              没单独写就沿用电脑那份 —— 多数步骤两边确实一样。
            */}
            {howTo.length > 0 && (
              <div className="mt-3.5 rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-gray-500">
                  <MousePointerClick className="w-3.5 h-3.5" />
                  怎么做{isMobile && step!.howToMobile ? '（手机上）' : ''}
                </p>
                <ol className="flex flex-col gap-1.5">
                  {howTo.map((line, n) => (
                    <li key={n} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
                      <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-gray-500 ring-1 ring-gray-200">
                        {n + 1}
                      </span>
                      <span className="min-w-0 [&_strong]:text-gray-900">
                        <ReactMarkdown components={{ p: ({ children }) => <>{children}</> }}>{line}</ReactMarkdown>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5 mt-2 border-t border-gray-100 shrink-0">
        {/* 抽屉从顶部下来时，把手挪到底边 */}
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

      {!anchored && isMobile && sheetAtTop && (
        <div className="flex justify-center pb-2.5 pt-0.5 shrink-0">
          <span className="h-1 w-9 rounded-full bg-gray-300" />
        </div>
      )}
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
          isMobile
            ? (sheetAtTop ? 'items-start justify-center' : 'items-end justify-center')
            : 'items-center justify-center p-4'
        }`}>
          {card}
        </div>
      )}
    </>
  );
};

export default OnboardingTour;
