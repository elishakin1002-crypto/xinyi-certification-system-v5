import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Briefcase, Coins, Percent, TrendingUp, Users } from 'lucide-react';
import { DashboardCard } from '../../services/dashboardMetrics';
import { openDashboardRoute } from '../../src/modules/dashboardNavigation';

type Props = {
  overviewCards: DashboardCard[];
  teamCards: DashboardCard[];
};

const cardSubtitleById: Record<string, string> = {
  'boss-revenue-count': '统计口径：本月完成且判定为营收项目的数量',
  'boss-revenue-amount': '统计口径：本月营收项目金额（缺失时回退合同金额）',
  'boss-conv': '统计口径：线索→营收项目（005A 口径）',
  'boss-overdue-amount': '统计口径：已逾期未回款金额',
  'boss-overdue-amt': '统计口径：已逾期未回款金额'
};

const isOverdueCard = (cardId: string) => cardId.includes('overdue');

const getOverviewTone = (cardId: string) => {
  if (cardId.includes('conv')) return { icon: 'bg-indigo-50 text-indigo-600', hover: 'hover:border-indigo-200' };
  if (cardId.includes('revenue-count')) return { icon: 'bg-emerald-50 text-emerald-600', hover: 'hover:border-emerald-200' };
  return { icon: 'bg-blue-50 text-blue-600', hover: 'hover:border-blue-200' };
};

const getOverviewIcon = (cardId: string) => {
  if (isOverdueCard(cardId)) return <AlertTriangle className="w-6 h-6" />;
  if (cardId.includes('conv')) return <Percent className="w-6 h-6" />;
  if (cardId.includes('revenue-count')) return <Briefcase className="w-6 h-6" />;
  return <Coins className="w-6 h-6" />;
};

const BossDashboard: React.FC<Props> = ({ overviewCards, teamCards }) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* 顶部经营指标 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {overviewCards.map(card => {
          if (isOverdueCard(card.id)) {
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => openDashboardRoute(navigate, card.route)}
                title={cardSubtitleById[card.id] || card.hint || card.title}
                className="text-left bg-gradient-to-br from-rose-500 to-red-600 p-5 rounded-2xl shadow-lg flex items-center text-white transition-transform active:scale-[0.98]"
              >
                <div className="p-3 bg-white/20 rounded-xl mr-4"><AlertTriangle className="w-6 h-6" /></div>
                <div className="min-w-0">
                  <div className="text-2xl font-black truncate">{card.value || '暂无数据'}</div>
                  <div className="text-xs opacity-80 font-bold uppercase tracking-tight">{card.title}</div>
                </div>
              </button>
            );
          }
          const tone = getOverviewTone(card.id);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => openDashboardRoute(navigate, card.route)}
              title={cardSubtitleById[card.id] || card.hint || card.title}
              className={`text-left bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group transition-colors ${tone.hover}`}
            >
              <div className={`p-3 rounded-xl mr-4 group-hover:scale-110 transition-transform ${tone.icon}`}>
                {getOverviewIcon(card.id)}
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-black text-gray-900 truncate">{card.value || '暂无数据'}</div>
                <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">{card.title}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 团队产能与执行 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-black text-gray-900 flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-600" /> 团队产能与执行
            </h2>
            <p className="text-xs text-gray-500 mt-1">关注产能、延误与日志覆盖，确保团队运转稳定。</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="inline-flex items-center gap-1 rounded-full border border-blue-200 px-3 py-1 text-[11px] font-bold text-blue-700 transition hover:bg-blue-50"
          >
            <TrendingUp className="w-3.5 h-3.5" /> 查看全部项目 <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {teamCards.map(card => (
            <button
              key={card.id}
              type="button"
              /*
                必须走 openDashboardRoute，不能直接 navigate(card.route)。

                卡片路由里的查询参数（?view=team / ?filter=delay / ?tab=logs）
                要由 buildDashboardRouteTarget 翻译成 location.state.dashboardFocus，
                目标页面读的是 state，**不读查询串**。直接 navigate 等于跳过翻译，
                页面收不到筛选条件，打开就是全量列表。

                2026-08-22 查工作台真实性时发现这三张团队卡就是这么写的：
                点下去有反应、页面也切了，但筛选静默失效——
                这种「看起来正常」的失效最难被发现。
              */
              onClick={() => openDashboardRoute(navigate, card.route)}
              title={card.hint || card.title}
              className="text-left rounded-2xl border border-gray-100 bg-gray-50 p-4 transition-all hover:border-blue-200 hover:bg-blue-50/60"
            >
              <div className="text-[11px] font-black uppercase tracking-wide text-gray-500">{card.title}</div>
              <div className="mt-2 text-xl font-black text-blue-700">{card.value || '—'}</div>
              {card.hint && <div className="mt-2 text-xs leading-6 text-gray-600 line-clamp-2">{card.hint}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BossDashboard;
