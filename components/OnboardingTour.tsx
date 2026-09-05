import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, X, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../context/AppContext';
import { dataService } from '../services/dataService';
import { getTour } from '../src/modules/onboarding/steps';

/**
 * 新手引导。
 *
 * ── 四条设计原则 ──────────────────────────────────────────────
 *
 * 1）**说到哪，就指到哪。**
 *    2026-09-05 金恩来反馈：「只会在左侧导航栏里跳动，却没有解释到哪，
 *    就指向哪里」。查下来 steps.ts 里的 target 字段**从头到尾是死代码** ——
 *    组件只弹了个居中的框，从来没用过它。
 *
 *    人读引导时脑子里在问的是「它说的那个东西在屏幕哪儿」。
 *    这个问题不回答，讲得再有道理也落不了地：
 *    合上引导之后他还是要自己找一遍，而多数人不会找，就放弃了。
 *
 *    所以现在：把那块**挖出来高亮**，四周压暗，说明气泡贴在它旁边。
 *
 * 2）**必须能跳过，而且跳过要显眼。**
 *    强制看完的引导只会让人乱点，反而什么都没记住。
 *
 * 3）**必须能重看。**
 *    第一次登录时人最想做的是「赶紧看看这东西长什么样」，
 *    引导反而是干扰。用了两天遇到问题，才是真正想看引导的时候。
 *
 * 4）**看过就不再自动弹。**
 *    记在本机（localStorage），换台电脑重看一次也无所谓。
 */

const seenKey = (userId: string) => `onboard_seen_${userId}`;

/** 高亮框四周留的空隙，让被指的东西不至于贴着边 */
const PAD = 8;
/** 气泡宽度。窄屏时会退成居中弹窗，不再贴着元素 */
const CARD_W = 380;
const NARROW = 720;

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
  const cardRef = useRef<HTMLDivElement>(null);

  const tour = getTour(currentUser?.roles as any);

  useEffect(() => {
    if (forceOpen) { setOpen(true); setI(0); return; }
    if (!tour || !currentUser?.id) return;
    try {
      const seen = Number(dataService.get(seenKey(currentUser.id), 0));
      /*
        版本比对而不是布尔值：引导内容有实质更新时把 version +1，
        看过旧版的人会再看一次新版。
      */
      if (seen < tour.version) setOpen(true);
    } catch { /* 读不到就不弹，不打扰 */ }
  }, [forceOpen, tour, currentUser?.id]);

  const step = open && tour && i > 0 ? tour.steps[i - 1] : null;
  const targetSel = step?.target;

  /*
    找到要指的那个元素，量出它的位置。

    **找不到就退回居中弹窗，绝不报错也绝不空白。**
    元素可能因为权限、折叠、还没渲染完而不在页面上 ——
    引导的价值是解释，指不到顶多少一层帮助，
    但要是因此白屏或卡住，就成了新人对系统的第一印象。
  */
  const measure = useCallback(() => {
    if (!targetSel || typeof document === 'undefined') { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-onboard="${targetSel}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { setRect(null); return; }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [targetSel]);

  useLayoutEffect(() => {
    if (!open) return;
    /*
      量两次：切页面之后 DOM 要一帧才渲染出来，立刻量会量到旧的位置或量不到。
      第二次延后 260ms，覆盖页面切换 + 滚动动画。
    */
    measure();
    const t1 = window.setTimeout(() => {
      const el = targetSel && document.querySelector<HTMLElement>(`[data-onboard="${targetSel}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(measure, 260);
    }, 60);
    return () => window.clearTimeout(t1);
  }, [open, i, targetSel, measure]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => measure();
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
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const anchored = Boolean(rect) && vw >= NARROW;

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
    气泡放哪：优先放在被指元素的右边（导航在左侧，最常见），
    右边放不下就放左边，左右都放不下就放下方。
    夹在视口里，不让它跑出屏幕 —— 跑出去就等于没有。
  */
  const cardPos = (): React.CSSProperties => {
    if (!anchored || !rect) return {};
    const gap = 16;
    const estH = 260;
    let left = rect.left + rect.width + gap;
    if (left + CARD_W > vw - 12) left = rect.left - CARD_W - gap;
    if (left < 12) left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
    let top = rect.top + rect.height / 2 - estH / 2;
    top = Math.max(12, Math.min(top, vh - estH - 12));
    return { position: 'fixed', top, left, width: CARD_W };
  };

  const maskColor = 'rgba(0,0,0,0.55)';
  const hole = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const card = (
    <div
      ref={cardRef}
      style={anchored ? cardPos() : undefined}
      className={`bg-white rounded-2xl shadow-2xl overflow-hidden pointer-events-auto ${anchored ? 'z-[72]' : 'w-full max-w-md'}`}
    >
      <div className="flex items-center justify-between px-5 py-3.5 bg-blue-600 text-white">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4" />
          <span className="text-sm font-black">新手引导</span>
        </div>
        {/*
          跳过键放在最显眼的右上角，不藏起来。
          藏跳过键换来的「完成率」是假的 —— 人只是乱点过去了。
        */}
        <button onClick={finish} className="text-xs font-bold text-white/80 hover:text-white flex items-center gap-1">
          跳过 <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className={`px-6 py-5 ${anchored ? '' : 'min-h-[210px] py-6'}`}>
        {isIntro ? (
          <>
            <p className="text-xs font-black text-blue-600 mb-3">
              {currentUser?.name}，欢迎
            </p>
            <div className="text-sm text-gray-800 leading-relaxed prose-sm">
              <ReactMarkdown>{tour.intro}</ReactMarkdown>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] font-black text-gray-400 mb-2">
              第 {i} 步 / 共 {total} 步
              {/*
                指不到的时候明说，而不是假装指到了。
                人照着找找不到，会以为是自己眼瞎或者系统坏了。

                措辞刻意含糊：原因可能是权限、可能是要先选中一个项目、
                也可能是页面还空着。**说不准就别说死** ——
                写成「你没权限」而实际只是列表为空，比不说更误导。
              */}
              {step?.target && !rect && (
                <span className="ml-2 font-bold text-gray-300">（这一块现在不在屏幕上）</span>
              )}
            </p>
            <h3 className="text-lg font-black text-gray-900 mb-3">{step!.title}</h3>
            <div className="text-sm text-gray-700 leading-relaxed">
              <ReactMarkdown>{step!.body}</ReactMarkdown>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50">
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

        没用 SVG mask 或 box-shadow 撑出的洞：那两种写法在被指元素
        本身有圆角、或者页面横向滚动时容易错位半个像素，
        而这里错位一点点就会露出一条黑边，看着像渲染坏了。
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
        <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
          {card}
        </div>
      )}
    </>
  );
};

export default OnboardingTour;
