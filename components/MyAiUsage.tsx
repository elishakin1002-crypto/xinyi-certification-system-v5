import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

/**
 * 「我今天用了多少 AI」。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 * 2026-09-04 把 AI 配置中心收窄成只给总经理和系统管理员之后，
 * 顾问就完全看不到自己的用量了。
 *
 * **「不给配置权」不等于「不让人知道自己用了多少」。**
 * 一个人不知道自己还剩多少，只有两种结局：
 *   · 怕超额而不敢用 —— 这套系统就白做了
 *   · 撞上限时莫名其妙被拦，以为是系统坏了
 *
 * ── 设计上最重要的一条：平时不出声 ────────────────────────────
 * 额度定得很宽（顾问一天 30 万 tokens，约正常用量的 7 倍），
 * 正常干活根本碰不到。天天把「你已用 2%」摆在眼前，
 * 只会让人以为自己在被计量、被考核，反而不敢用。
 *
 * 所以：**用量低于 70% 时完全不显示**，到了才出现。
 * 和错误摘要「没事不吵」是同一个道理。
 *
 * ── 不显示别人的 ──────────────────────────────────────────────
 * 谁用得多是管理话题，不该让同事之间互相看见 ——
 * 那会变成一种无形的比较压力，而用得多用得少本来就和绩效无关。
 */

type Usage = { used: number; limit: number | null; pct: number; unlimited: boolean };

/** 低于这个比例完全不显示。见上面「平时不出声」。 */
const SHOW_FROM_PCT = 70;

export const MyAiUsage: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/ai/my-usage', { credentials: 'include' });
        const b = await r.json();
        if (!cancelled && r.ok && b?.ok !== false) setUsage(b.data);
      } catch { /* 查不到就不显示，不打扰 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!usage || usage.unlimited || usage.pct < SHOW_FROM_PCT) return null;

  const danger = usage.pct >= 90;
  const k = (v: number) => `${Math.round(v / 1000)}k`;

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-[11px] font-bold ${danger ? 'text-red-600' : 'text-amber-600'}`}>
        <Gauge className="w-3.5 h-3.5" />
        今日 AI 用量 {usage.pct}%
      </div>
    );
  }

  return (
    <div className={`rounded-xl px-3 py-2.5 border ${
      danger ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'
    }`}>
      <div className="flex items-center gap-2">
        <Gauge className={`w-4 h-4 shrink-0 ${danger ? 'text-red-600' : 'text-amber-600'}`} />
        <p className={`text-xs font-bold ${danger ? 'text-red-700' : 'text-amber-700'}`}>
          今日 AI 用量 {k(usage.used)} / {k(usage.limit || 0)}（{usage.pct}%）
        </p>
      </div>
      {/*
        说清楚「撞到了会怎样」和「该找谁」。
        只给一个百分比，人不知道满了之后是被永久停用还是明天恢复，
        那种不确定比数字本身更让人不敢用。
      */}
      <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
        {danger
          ? '快到今天的上限了。用满之后当天不能再用 AI，明天零点自动恢复；确实需要就找系统管理员放开。'
          : '这个上限是防程序异常的兜底，正常使用碰不到。明天零点重新计算。'}
      </p>
    </div>
  );
};

export default MyAiUsage;
