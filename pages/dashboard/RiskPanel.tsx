import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { DashboardCard } from '../../services/dashboardMetrics';

export type RiskAlertItem = {
  id: string;
  severityLabel: string;
  severity: 'high' | 'medium' | 'low';
  date: string;
  title: string;
  meta: string;
};

type Props = {
  /** 风险统计卡，只有老板视角有；其他视角传空数组则只显示明细流 */
  statCards: DashboardCard[];
  alerts: RiskAlertItem[];
  onStatClick: (route: string) => void;
  onAlertClick: (alert: RiskAlertItem) => void;
};

const statTone = (cardId: string) => {
  if (cardId.includes('high-risk')) return 'border-red-100 bg-red-50/70';
  if (cardId.includes('overdue-receivable')) return 'border-amber-100 bg-amber-50/70';
  if (cardId.includes('churn')) return 'border-orange-100 bg-orange-50/70';
  return 'border-rose-100 bg-rose-50/70';
};

const isTriggered = (card: DashboardCard) => {
  const raw = String(card.value || '').trim();
  if (!raw || raw === '暂无数据') return false;
  return !/^0(\.0+)?%?$/.test(raw.replace(/[¥,\s]/g, ''));
};

const severityStyle = (severity: RiskAlertItem['severity']) => {
  if (severity === 'high') return 'bg-red-50 text-red-600 border-red-100';
  if (severity === 'medium') return 'bg-amber-50 text-amber-600 border-amber-100';
  return 'bg-indigo-50 text-indigo-600 border-indigo-100';
};

const RiskPanel: React.FC<Props> = ({ statCards, alerts, onStatClick, onAlertClick }) => {
  const triggered = statCards.filter(isTriggered);
  const narrative = statCards.length === 0
    ? (alerts.length > 0 ? `当前有 ${alerts.length} 条异常提醒待处理，建议按严重度自上而下清理。` : '当前没有异常提醒，保持现有跟进节奏即可。')
    : triggered.length > 0
      ? `当前有 ${triggered.length} 类风险触发：${triggered.map(card => `${card.title} ${card.value}`).join('、')}。建议先处理逾期金额最大的合同，再回头看高风险项目。`
      : '当前没有风险项触发阈值，按现有节奏跟进即可，重点放在本月营收目标上。';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-gray-900 flex items-center">
            <ShieldAlert className="w-5 h-5 mr-2 text-red-600" /> 风险与异常
          </h2>
          <p className="text-xs text-gray-500 mt-1">左边是有多少，右边是具体哪几条，不用来回翻页。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          {statCards.length > 0 && (
            <span className={`px-2 py-1 rounded-full border ${triggered.length > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
              {triggered.length > 0 ? `${triggered.length} 类触发` : '暂无触发'}
            </span>
          )}
          <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200">明细 {alerts.length} 条</span>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${statCards.length > 0 ? 'xl:grid-cols-5' : ''}`}>
        {statCards.length > 0 && (
          <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
            {statCards.map(card => (
              <button
                key={card.id}
                type="button"
                onClick={() => onStatClick(card.route)}
                title={card.hint || card.title}
                className={`text-left rounded-2xl border p-4 transition-all hover:shadow-sm active:scale-[0.99] ${statTone(card.id)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-black uppercase tracking-wide text-gray-500">{card.title}</div>
                  <div className="text-xl font-black text-gray-900 shrink-0">{card.value || '—'}</div>
                </div>
                <div className="mt-1 text-xs leading-5 text-gray-600 line-clamp-1">{card.hint || '点击查看处置对象'}</div>
              </button>
            ))}
          </div>
        )}

        <div className={statCards.length > 0 ? 'xl:col-span-3' : ''}>
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
            <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
              {alerts.length > 0 ? alerts.map(alert => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => onAlertClick(alert)}
                  className="w-full text-left p-3 rounded-xl border border-gray-100 bg-white transition hover:border-red-200 hover:bg-red-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${severityStyle(alert.severity)}`}>
                      {alert.severityLabel}
                    </span>
                    <span className="text-[10px] text-gray-400">{alert.date || '-'}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-900 mt-1.5 line-clamp-1">{alert.title}</p>
                  {alert.meta && <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{alert.meta}</p>}
                </button>
              )) : (
                <div className="py-12 text-center text-sm text-gray-400">暂无异常提醒</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-7">
        {narrative}
      </div>
    </div>
  );
};

export default RiskPanel;
