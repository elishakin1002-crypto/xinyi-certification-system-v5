import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, X, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../context/AppContext';
import { dataService } from '../services/dataService';
import { getTour } from '../src/modules/onboarding/steps';

/**
 * 新手引导。
 *
 * ── 三条设计原则 ──────────────────────────────────────────────
 *
 * 1）**必须能跳过，而且跳过要显眼。**
 *    强制看完的引导只会让人乱点，反而什么都没记住。
 *    真想学的人会看，不想看的人给他跳过键，他至少不会讨厌这个系统。
 *
 * 2）**必须能重看。**
 *    第一次登录时人最想做的是「赶紧看看这东西长什么样」，
 *    引导反而是干扰。等他用了两天遇到问题，才是真正想看引导的时候 ——
 *    那时候找不到入口，这个功能就白做了。
 *
 * 3）**看过就不再自动弹。**
 *    每次登录都弹一遍，第三次就变成骚扰。
 *    记在本机（localStorage），换台电脑重看一次也无所谓，
 *    比记在服务器上省一张表，而代价只是偶尔多看一次。
 */

const seenKey = (userId: string) => `onboard_seen_${userId}`;

export const OnboardingTour: React.FC<{
  /** 手动重看时传 true，绕过「看过就不弹」的判断 */
  forceOpen?: boolean;
  onClose?: () => void;
}> = ({ forceOpen = false, onClose }) => {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  const tour = getTour(currentUser?.roles as any);

  useEffect(() => {
    if (forceOpen) { setOpen(true); setI(0); return; }
    if (!tour || !currentUser?.id) return;
    try {
      const seen = Number(dataService.get(seenKey(currentUser.id), 0));
      /*
        版本比对而不是布尔值：引导内容有实质更新时把 version +1，
        看过旧版的人会再看一次新版。
        用布尔的话，改了内容也没人会知道。
      */
      if (seen < tour.version) setOpen(true);
    } catch { /* 读不到就不弹，不打扰 */ }
  }, [forceOpen, tour, currentUser?.id]);

  if (!open || !tour) return null;

  const total = tour.steps.length;
  const isIntro = i === 0;
  const step = isIntro ? null : tour.steps[i - 1];

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
    setI(next);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={finish} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl pointer-events-auto overflow-hidden">

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

          <div className="px-6 py-6 min-h-[210px]">
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
      </div>
    </>
  );
};

export default OnboardingTour;
