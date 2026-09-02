import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  AlertTriangle, ArrowRight, Clock, Loader2, RefreshCw, Sparkles, Target, Plus, Check,
} from 'lucide-react';
import { monthlyReviewService, MonthlySnapshot } from '../services/monthlyReviewService';
import { longestZeroStreak, MonthlyAction, MonthlyJudgement } from '../src/modules/review/normalize';

/**
 * 本月经营判断。取代原来的 SWOT + BCG 战略推演。
 *
 * ── 为什么换掉 ──────────────────────────────────────────────
 * SWOT/BCG 是给大企业做年度规划的框架。对一家 200-400 单/年的公司，
 * 它输出「优势：本地化服务；劣势：人手不足」——每条都对，每条都不指向动作。
 * 实测上线至今一次都没被用过（战略洞察为空、战略任务 0 条）。
 *
 * ── 这个页面的规矩 ──────────────────────────────────────────
 * ① **事实先摆出来，不调模型。** 下面这些数字打开就能看，一分钱不花。
 *    连续几个月零签约、最久那笔欠了多少天——老板看了自己就能判断。
 * ② **AI 必须由人点按钮才调。** 摘要功能踩过「一打开就同步调 AI」的坑，
 *    点一下花一次钱还要等。
 * ③ **每条建议都标出依据的数字。** 给不出依据的条目在 normalize 里已经被丢掉，
 *    这里再把依据显式渲染出来——老板能顺着数字回去核对，才敢照着做。
 */

const yuan = (n: number) => `¥${Number(n || 0).toLocaleString('zh-CN')}`;
const wan = (n: number) => `${(Number(n || 0) / 10000).toFixed(1)} 万`;

const URGENCY_STYLE: Record<string, { chip: string; label: string }> = {
  high: { chip: 'bg-red-50 text-red-700 border-red-200', label: '紧急' },
  medium: { chip: 'bg-amber-50 text-amber-700 border-amber-200', label: '重要' },
  low: { chip: 'bg-gray-50 text-gray-600 border-gray-200', label: '可缓' },
};

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; alert?: boolean }> = ({
  label, value, hint, alert,
}) => (
  <div className={`rounded-xl border p-4 ${alert ? 'border-red-200 bg-red-50/60' : 'border-gray-100 bg-white'}`}>
    <p className="text-xs font-medium text-gray-500">{label}</p>
    <p className={`mt-1 text-2xl font-bold tabular-nums ${alert ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
    {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
  </div>
);

interface Props {
  /** 把一条建议收成战役。由 Strategy 页传进来，这个组件不直接碰全局状态 */
  onAdopt?: (action: MonthlyAction) => void;
}

export const MonthlyReview: React.FC<Props> = ({ onAdopt }) => {
  const [snapshot, setSnapshot] = useState<MonthlySnapshot | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [judgement, setJudgement] = useState<MonthlyJudgement | null>(null);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState('');
  const [adopted, setAdopted] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await monthlyReviewService.fetchSnapshot();
      setSnapshot(data.snapshot);
      setPrompt(data.prompt);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '经营快照加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 只拉事实。**刻意不在这里调 AI**——见文件头第 ② 条
  useEffect(() => { load(); }, [load]);

  const askAI = async () => {
    if (!prompt) return;
    setAsking(true);
    setAiError('');
    try {
      setJudgement(await monthlyReviewService.askAI(prompt, snapshot?.month || ''));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 判断失败');
    } finally {
      setAsking(false);
    }
  };

  const trend = snapshot?.signingTrend || [];
  const zeroStreak = useMemo(() => longestZeroStreak(trend), [trend]);
  const recentDeals = useMemo(() => trend.slice(-3).reduce((s, m) => s + (m.deals || 0), 0), [trend]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-gray-100 bg-white py-16 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在汇总经营数据…
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="flex items-center font-bold text-red-800">
          <AlertTriangle className="mr-2 h-5 w-5" /> {error || '没有取到经营数据'}
        </p>
        <button onClick={load} className="mt-3 inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );
  }

  const { overdueReceivables: overdue, deliveryBottlenecks: bottleneck, customerMix: mix, dataGaps } = snapshot;

  return (
    <div className="space-y-6">
      {/* ── 事实 ────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex items-center font-bold text-gray-900">
            <Target className="mr-2 h-5 w-5 text-blue-600" />
            {snapshot.month} 经营事实
          </h3>
          <span className="text-xs text-gray-400">下面每个数字都能在系统里查到具体记录</span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="近三个月签约" value={`${recentDeals} 单`} hint="含本月" />
          <Stat
            label="最长连续零签约"
            value={`${zeroStreak} 个月`}
            hint={zeroStreak >= 2 ? '空档在柱状图上是看不见的' : '近 13 个月内'}
            alert={zeroStreak >= 2}
          />
          <Stat
            label="逾期回款"
            value={wan(overdue.totalAmount)}
            hint={`${overdue.count} 笔`}
            alert={overdue.count > 0}
          />
          <Stat
            label="逾期任务"
            value={`${bottleneck.overdueTasks} 条`}
            hint={`在办 ${bottleneck.openTasks} 条`}
            alert={bottleneck.overdueTasks > 0}
          />
        </div>
      </div>

      {/* 签约趋势。零签约的月份画成浅灰空柱，否则它在图上是一片空白，眼睛会略过 */}
      <div className="rounded-xl border border-gray-100 bg-white p-5">
        <h4 className="mb-4 text-sm font-bold text-gray-900">近 13 个月签约</h4>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(m: string) => String(m).slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(v: any, name: string) => (name === 'deals' ? [`${v} 单`, '签约'] : [yuan(v), '金额'])}
                labelFormatter={(m: string) => m}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
              />
              <Bar dataKey="deals" radius={[3, 3, 0, 0]} minPointSize={2}>
                {trend.map((m, i) => (
                  <Cell key={i} fill={m.deals > 0 ? '#2563EB' : '#FCA5A5'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          红色是<strong className="font-medium text-red-500">零签约</strong>的月份。补齐空月份是刻意的——没有合同的月份本来不会出现在统计里。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 逾期回款 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h4 className="mb-3 flex items-center text-sm font-bold text-gray-900">
            <Clock className="mr-2 h-4 w-4 text-red-500" /> 逾期最久的几笔
          </h4>
          {overdue.worst.length === 0 ? (
            <p className="py-4 text-sm text-gray-400">没有逾期回款。</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {overdue.worst.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-gray-700">{r.customer}</span>
                  <span className="shrink-0 tabular-nums text-gray-500">
                    {yuan(r.amount)} · <span className="font-medium text-red-600">逾期 {r.overdueDays} 天</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 交付卡点 */}
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h4 className="mb-3 flex items-center text-sm font-bold text-gray-900">
            <AlertTriangle className="mr-2 h-4 w-4 text-amber-500" /> 最常卡住的环节
          </h4>
          {bottleneck.topStuck.length === 0 ? (
            <p className="py-4 text-sm text-gray-400">没有逾期任务。</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {bottleneck.topStuck.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-gray-700">{t.title}</span>
                  <span className="shrink-0 tabular-nums font-medium text-amber-600">{t.count} 个项目</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 数据缺口。**必须显示**——缺什么数据决定了哪些判断做不了 */}
      {dataGaps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h4 className="mb-2 flex items-center text-sm font-bold text-amber-900">
            <AlertTriangle className="mr-2 h-4 w-4" /> 这些数据还没有，相关判断做不了
          </h4>
          <ul className="space-y-1.5">
            {dataGaps.map((g, i) => (
              <li key={i} className="flex text-sm text-amber-800"><span className="mr-2">·</span>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── AI 判断 ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center font-bold text-gray-900">
              <Sparkles className="mr-2 h-4 w-4 text-indigo-600" /> 这个月最该做的三件事
            </h4>
            <p className="mt-1 text-xs text-gray-500">
              把上面的数字交给 AI 判断。<strong className="font-medium">每条建议都要指回具体数字</strong>，指不回的会被丢掉。
            </p>
          </div>
          <button
            type="button"
            onClick={askAI}
            disabled={asking}
            className={`inline-flex shrink-0 items-center rounded-lg px-4 py-2 text-sm font-bold shadow-sm transition-all active:scale-95 ${
              asking ? 'cursor-wait bg-indigo-50 text-indigo-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {asking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {asking ? '正在判断…' : judgement ? '重新判断' : '让 AI 读这些数字'}
          </button>
        </div>

        {aiError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{aiError}</p>
        )}

        {judgement && (
          <div className="mt-4 space-y-3">
            {judgement.actions.length === 0 && (
              <p className="rounded-lg bg-white px-4 py-3 text-sm text-gray-500 ring-1 ring-gray-100">
                AI 没有给出任何有数字依据的建议。<strong className="font-medium">这本身是个结果</strong>——
                通常说明数据还不够支撑判断，先看上面的数据缺口。
              </p>
            )}

            {judgement.actions.map((a, i) => {
              const style = URGENCY_STYLE[a.urgency] || URGENCY_STYLE.medium;
              const key = `${a.title}-${i}`;
              return (
                <div key={key} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-bold text-gray-900">{a.title}</p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">
                    <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">依据</span>
                    {a.why}
                  </p>
                  {a.firstStep && (
                    <p className="mt-1.5 flex items-start text-sm text-gray-600">
                      <ArrowRight className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span><span className="font-medium text-gray-700">这周先做：</span>{a.firstStep}</span>
                    </p>
                  )}
                  {onAdopt && (
                    <button
                      type="button"
                      disabled={adopted[key]}
                      onClick={() => { onAdopt(a); setAdopted((p) => ({ ...p, [key]: true })); }}
                      className={`mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                        adopted[key]
                          ? 'cursor-default bg-emerald-50 text-emerald-700'
                          : 'bg-gray-900 text-white hover:bg-gray-700'
                      }`}
                    >
                      {adopted[key] ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                      {adopted[key] ? '已收进战役' : '收进战役'}
                    </button>
                  )}
                </div>
              );
            })}

            {judgement.droppedCount > 0 && (
              <p className="text-xs text-gray-400">
                另有 {judgement.droppedCount} 条被丢掉：没写清依据的哪个数字，或超出三条上限。
              </p>
            )}

            {judgement.cannotJudge.length > 0 && (
              <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">判断不了的</p>
                <ul className="space-y-1">
                  {judgement.cannotJudge.map((c, i) => (
                    <li key={i} className="flex text-sm text-gray-600"><span className="mr-2">·</span>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {judgement.dataToFix.length > 0 && (
              <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">补上这些数据能多回答什么</p>
                <ul className="space-y-1">
                  {judgement.dataToFix.map((d, i) => (
                    <li key={i} className="flex text-sm text-gray-600"><span className="mr-2">·</span>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 客户集中度。单独放最后：它是慢变量，不是这个月要动的事 */}
      {mix.topCustomers.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h4 className="mb-3 text-sm font-bold text-gray-900">客户集中度</h4>
          <div className="flex flex-wrap gap-2">
            {mix.topCustomers.map((c, i) => (
              <span key={i} className="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-700 ring-1 ring-gray-100">
                {c.name} <span className="tabular-nums text-gray-400">{wan(c.amount)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyReview;
