import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Briefcase, Coins, Percent, Users } from 'lucide-react';
import { DashboardCard, RoleDashboardMetrics } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';

export type PersonaSection = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  cards: DashboardCard[];
  cols: string;
};

type Props = {
  metrics: RoleDashboardMetrics;
  /** 顶部 KPI 区标题与说明 */
  headline: { title: string; subtitle: string };
  /** 顶部 KPI 中用渐变卡强调的指标 id */
  emphasisId: string;
  /** 中部与下部区块 */
  sections: PersonaSection[];
  list: { title: string; subtitle: string; icon: React.ReactNode };
};

const isAlertCard = (cardId: string) => /overdue|stale|sleeping|abnormal|expiring|due-soon/.test(cardId);

const cardIcon = (cardId: string) => {
  if (isAlertCard(cardId)) return <AlertTriangle className="w-6 h-6" />;
  if (/conversion|ratio|concentration|big-customer/.test(cardId)) return <Percent className="w-6 h-6" />;
  if (/amt|amount|paid|rec$|rec-|sign/.test(cardId)) return <Coins className="w-6 h-6" />;
  if (/project|task/.test(cardId)) return <Briefcase className="w-6 h-6" />;
  if (/lead|customer|contact/.test(cardId)) return <Users className="w-6 h-6" />;
  return <Activity className="w-6 h-6" />;
};

const kpiTone = (cardId: string) => {
  if (isAlertCard(cardId)) return { icon: 'bg-amber-50 text-amber-600', hover: 'hover:border-amber-200' };
  if (/conversion|ratio|concentration/.test(cardId)) return { icon: 'bg-indigo-50 text-indigo-600', hover: 'hover:border-indigo-200' };
  if (/amt|amount|paid|sign/.test(cardId)) return { icon: 'bg-blue-50 text-blue-600', hover: 'hover:border-blue-200' };
  return { icon: 'bg-emerald-50 text-emerald-600', hover: 'hover:border-emerald-200' };
};

const itemTone = (cardId: string) =>
  isAlertCard(cardId) ? 'border-amber-100 bg-amber-50/70' : 'border-gray-100 bg-gray-50';

const PersonaDashboard: React.FC<Props> = ({ metrics, headline, emphasisId, sections, list }) => {
  const navigate = useNavigate();
  const topCards = metrics.topCards || [];

  return (
    <div className="space-y-6">
      {/* 顶部 KPI */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-black text-gray-900">{headline.title}</h2>
          <p className="text-xs text-gray-500 mt-1">{headline.subtitle}</p>
        </div>
        {topCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-400">暂无数据</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {topCards.map(card => {
              if (card.id === emphasisId) {
                const alert = isAlertCard(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => openDashboardRoute(navigate, card.route)}
                    title={card.hint || card.title}
                    className={`text-left p-5 rounded-2xl shadow-lg flex items-center text-white transition-transform active:scale-[0.98] bg-gradient-to-br ${
                      alert ? 'from-rose-500 to-red-600' : 'from-indigo-600 to-blue-700'
                    }`}
                  >
                    <div className="p-3 bg-white/20 rounded-xl mr-4">{cardIcon(card.id)}</div>
                    <div className="min-w-0">
                      <div className="text-2xl font-black truncate">{card.value || '暂无数据'}</div>
                      <div className="text-xs opacity-80 font-bold uppercase tracking-tight">{card.title}</div>
                    </div>
                  </button>
                );
              }
              const tone = kpiTone(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openDashboardRoute(navigate, card.route)}
                  title={card.hint || card.title}
                  className={`text-left bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group transition-colors ${tone.hover}`}
                >
                  <div className={`p-3 rounded-xl mr-4 group-hover:scale-110 transition-transform ${tone.icon}`}>
                    {cardIcon(card.id)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-black text-gray-900 truncate">{card.value || '暂无数据'}</div>
                    <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">{card.title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 中部 / 下部区块 */}
      {sections.map(section => (
        <div key={section.key} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center">
                <span className="mr-2">{section.icon}</span>
                {section.title}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{section.subtitle}</p>
            </div>
            <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200 self-start">
              共 {section.cards.length} 项
            </span>
          </div>
          {section.cards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-400">暂无数据</div>
          ) : (
            <div className={`grid ${section.cols} gap-3`}>
              {section.cards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openDashboardRoute(navigate, card.route)}
                  title={card.hint || card.title}
                  className={`text-left rounded-2xl border p-4 transition-all hover:shadow-sm active:scale-[0.99] ${itemTone(card.id)}`}
                >
                  <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 line-clamp-1">{card.title}</div>
                  <div className="mt-2 text-xl font-black text-gray-900 line-clamp-1">{card.value || '暂无数据'}</div>
                  {card.hint && <div className="mt-2 text-xs leading-5 text-gray-600 line-clamp-2">{card.hint}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 优先处理列表 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-black text-gray-900 flex items-center">
              <span className="mr-2">{list.icon}</span>
              {list.title}
            </h2>
            <p className="text-xs text-gray-500 mt-1">{list.subtitle}</p>
          </div>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-50 text-gray-600 border border-gray-200 self-start">
            {metrics.listItems.length} 条
          </span>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
          <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
            {metrics.listItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">暂无待处理事项</div>
            ) : (
              metrics.listItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  /*
                    同 BossDashboard 的团队卡片：待办列表项的路由带 leadId / projectId
                    等参数，要经 openDashboardRoute 翻译成 state 才会打开对应记录。
                    直接 navigate 只会跳到列表页，点哪条都一样。
                  */
                  onClick={() => openDashboardRoute(navigate, item.route)}
                  className="w-full flex items-center justify-between gap-3 text-left p-3 rounded-xl border border-gray-100 bg-white transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-900 line-clamp-1">{item.title}</div>
                    {item.subtitle && <div className="text-[11px] text-gray-500 mt-1 line-clamp-1">{item.subtitle}</div>}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PersonaDashboard;
